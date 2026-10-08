"""Which subjects and sheets the Materials directory (and so Paper Workspace) lists.

Paper Workspace is built from ``/catalog/materials``. A subject must be listed
because the student's cohort owns it and a sheet is published in it -- never
because of its name, its slug, its cohort code, how many sheets it has, or
whether those sheets are Active Study ready yet. Readiness is reported per sheet
(``hasActiveStudy``); the client decides what to do with it.
"""

from __future__ import annotations

from typing import Any

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.admin_services import create_sheet, unpublish_sheet
from apps.content.models import CatalogDocument, CatalogSubject, LearningObject
from apps.education.models import AcademicProgram, EducationNode, StudentCohort
from apps.education.services import create_node, set_node_status
from apps.education.tests.helpers import create_admin, published_path
from apps.files.services import create_managed_file
from apps.focus.tests.test_managed_active_study import _grant_focus

from .test_sheet_editions import _pdf, _questions

pytestmark = pytest.mark.django_db

DIRECTORY = "/api/v1/catalog/materials"


def _client(user: Any) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _subject_node(*, admin: Any, institution: EducationNode, title: str) -> EducationNode:
    node = create_node(
        actor=admin, parent=institution, kind=EducationNode.Kind.SUBJECT, title=title
    )
    return set_node_status(
        actor=admin,
        node_id=node.id,
        expected_revision=node.revision,
        status=EducationNode.Status.PUBLISHED,
    )


def _publish(
    *, admin: Any, subject: EducationNode, title: str, position: int = 0
) -> LearningObject:
    return create_sheet(
        actor=admin,
        subject=subject,
        managed_file=create_managed_file(owner=admin, upload=_pdf(22, "sheet.pdf"), kind="pdf"),
        title=title,
        summary="",
        position=position,
        publish=True,
        notify_students=False,
        allow_download=False,
    )


def _make_ready(*, admin_client: APIClient, sheet: LearningObject) -> None:
    base = f"/api/v1/operations/admin/content/sheets/{sheet.id}"
    revision = admin_client.get(f"{base}/active-study").json()["revision"]
    assert (
        admin_client.patch(
            f"{base}/active-study", {"expected_revision": revision, "enabled": True}, format="json"
        ).status_code
        == 200
    )
    assert (
        admin_client.put(
            f"{base}/active-study/questions/medium",
            {"expected_revision": 0, "payload": _questions(parts=4)},
            format="json",
        ).status_code
        == 200
    )


class World:
    """One cohort that owns two subjects, like any real batch."""

    def __init__(self, *, cohort_code: str = "year-1") -> None:
        self.admin = create_admin()
        self.admin_client = _client(self.admin)
        self.institution, first_node, _ = published_path(admin=self.admin)
        self.program = AcademicProgram.objects.create(code="p", name_en="P", name_ar="P")
        self.cohort = StudentCohort.objects.create(
            program=self.program, code=cohort_code, name_en="C", name_ar="C"
        )
        self.cohort.content_nodes.set([self.institution])
        self.nodes = {
            "first": first_node,
            "second": _subject_node(
                admin=self.admin, institution=self.institution, title="Second subject"
            ),
        }
        self.subjects = {
            key: CatalogSubject.objects.create(
                cohort=self.cohort,
                source_node=node,
                title=f"{key.title()} subject",
                slug=f"{key}-subject",
                material_slug=f"{cohort_code}-{key}-subject",
                position=index,
            )
            for index, (key, node) in enumerate(self.nodes.items())
        }
        self.student = create_user(email=f"student-{cohort_code}@example.com", cohort=self.cohort)
        _grant_focus(self.student)

    def sheet(
        self, key: str, title: str, *, ready: bool = False, position: int = 0
    ) -> LearningObject:
        sheet = _publish(admin=self.admin, subject=self.nodes[key], title=title, position=position)
        if ready:
            _make_ready(admin_client=self.admin_client, sheet=sheet)
        return sheet

    def directory(self) -> dict[str, dict[str, Any]]:
        response = _client(self.student).get(DIRECTORY)
        assert response.status_code == 200
        return {item["slug"]: item for item in response.json()["results"]}

    def listed(self, key: str) -> dict[str, Any] | None:
        return self.directory().get(self.subjects[key].material_slug)


@pytest.mark.parametrize("cohort_code", ["year-1", "batch-60", "60", "cohort-with-any-code"])
def test_a_subject_without_a_ready_sheet_is_listed_beside_one_that_has_one(
    cohort_code: str,
) -> None:
    world = World(cohort_code=cohort_code)
    world.sheet("first", "Ready sheet", ready=True)
    world.sheet("second", "Sheet still being prepared", ready=False)

    ready, preparing = world.listed("first"), world.listed("second")

    assert ready is not None and preparing is not None
    assert [sheet["hasActiveStudy"] for sheet in ready["sheets"]] == [True]
    # The subject is present and its sheet is honest about not being ready.
    assert [(sheet["title"], sheet["hasActiveStudy"]) for sheet in preparing["sheets"]] == [
        ("Sheet still being prepared", False)
    ]
    assert preparing["cohort"]["cohort_code"] == cohort_code


def test_every_sheet_of_a_subject_is_listed_whatever_mix_of_readiness_it_has() -> None:
    world = World()
    for position, (title, ready) in enumerate(
        [("One", True), ("Two", False), ("Three", True), ("Four", False), ("Five", False)]
    ):
        world.sheet("second", title, ready=ready, position=position)

    listed = world.listed("second")

    assert listed is not None
    assert [(sheet["title"], sheet["hasActiveStudy"]) for sheet in listed["sheets"]] == [
        ("One", True),
        ("Two", False),
        ("Three", True),
        ("Four", False),
        ("Five", False),
    ]
    assert [sheet["number"] for sheet in listed["sheets"]] == [1, 2, 3, 4, 5]
    assert len({sheet["learningObjectId"] for sheet in listed["sheets"]}) == 5


def test_a_sheets_readiness_is_independent_of_its_neighbours_in_the_subject() -> None:
    world = World()
    ready = world.sheet("first", "Ready", ready=True, position=0)
    world.sheet("first", "Not ready", ready=False, position=1)

    listed = world.listed("first")

    assert listed is not None
    by_title = {sheet["title"]: sheet for sheet in listed["sheets"]}
    assert by_title["Ready"]["hasActiveStudy"] is True
    assert by_title["Ready"]["learningObjectId"] == str(ready.id)
    assert by_title["Not ready"]["hasActiveStudy"] is False


def test_enabling_without_questions_and_questions_without_enabling_are_both_not_ready() -> None:
    world = World()
    enabled_only = world.sheet("first", "Enabled only", position=0)
    questions_only = world.sheet("first", "Questions only", position=1)
    base = "/api/v1/operations/admin/content/sheets"
    revision = world.admin_client.get(f"{base}/{enabled_only.id}/active-study").json()["revision"]
    world.admin_client.patch(
        f"{base}/{enabled_only.id}/active-study",
        {"expected_revision": revision, "enabled": True},
        format="json",
    )
    world.admin_client.put(
        f"{base}/{questions_only.id}/active-study/questions/medium",
        {"expected_revision": 0, "payload": _questions(parts=4)},
        format="json",
    )

    listed = world.listed("first")

    assert listed is not None
    assert {sheet["title"]: sheet["hasActiveStudy"] for sheet in listed["sheets"]} == {
        "Enabled only": False,
        "Questions only": False,
    }


def test_the_directory_does_not_depend_on_what_workspace_state_a_student_has() -> None:
    world = World()
    world.sheet("first", "With reader state", ready=True)
    world.sheet("second", "Without reader state", ready=True)
    before = world.directory()

    from apps.content.models import CatalogWorkspaceSnapshot

    document = CatalogDocument.objects.get(
        material_slug=world.subjects["first"].material_slug, is_active=True
    )
    CatalogWorkspaceSnapshot.objects.filter(user=world.student).delete()
    without = world.directory()
    # One subject has reader state, the other does not: the listing is the same.
    assert CatalogWorkspaceSnapshot.objects.filter(user=world.student).count() == 0
    assert document.material_slug in without
    assert without == before


def test_a_subject_with_no_sheets_is_still_listed_and_empty() -> None:
    world = World()
    world.sheet("first", "Only here", ready=True)

    empty = world.listed("second")

    assert empty is not None
    assert empty["sheets"] == []


def test_a_sheet_is_attached_to_its_subject_by_the_catalog_relationship() -> None:
    world = World()
    sheet = world.sheet("second", "Attached", ready=True)

    document = CatalogDocument.objects.get(version__learning_object=sheet, is_active=True)

    assert document.material_slug == world.subjects["second"].material_slug
    assert document.version_id == sheet.published_version_id
    assert document.version.academic_node.path.startswith(world.nodes["second"].path)
    assert world.listed("second") is not None


def test_a_second_subject_in_the_same_cohort_never_borrows_the_first_ones_sheets() -> None:
    world = World()
    world.sheet("first", "Belongs to first", ready=True)
    world.sheet("second", "Belongs to second", ready=True)

    directory = world.directory()

    assert [s["title"] for s in directory[world.subjects["first"].material_slug]["sheets"]] == [
        "Belongs to first"
    ]
    assert [s["title"] for s in directory[world.subjects["second"].material_slug]["sheets"]] == [
        "Belongs to second"
    ]


def test_unpublished_archived_and_inactive_sheets_are_left_out_of_a_listed_subject() -> None:
    world = World()
    kept = world.sheet("first", "Kept", ready=True, position=0)
    unpublished = world.sheet("first", "Unpublished", position=1)
    archived = world.sheet("first", "Archived", position=2)
    inactive = world.sheet("first", "Inactive document", position=3)
    unpublish_sheet(
        actor=world.admin, sheet_id=unpublished.id, expected_revision=unpublished.revision
    )
    LearningObject.objects.filter(id=archived.id).update(archived_at=timezone.now())
    CatalogDocument.objects.filter(version__learning_object=inactive).update(is_active=False)

    listed = world.listed("first")

    # The subject stays; only the sheets that are not live are absent, each for its own reason.
    assert listed is not None
    assert [sheet["learningObjectId"] for sheet in listed["sheets"]] == [str(kept.id)]


def test_a_document_filed_under_the_wrong_route_key_is_excluded_not_misattributed() -> None:
    world = World()
    sheet = world.sheet("first", "Misfiled", ready=True)
    CatalogDocument.objects.filter(version__learning_object=sheet).update(
        material_slug=world.subjects["second"].material_slug
    )

    # The second subject's node does not contain the sheet, so neither lists it.
    assert world.listed("first") is not None
    assert world.listed("first")["sheets"] == []  # type: ignore[index]
    assert world.listed("second")["sheets"] == []  # type: ignore[index]


def test_inactive_subjects_and_inactive_cohorts_are_the_only_ways_to_hide_a_whole_subject() -> None:
    world = World()
    world.sheet("first", "Ready", ready=True)
    world.sheet("second", "Ready too", ready=True)

    CatalogSubject.objects.filter(id=world.subjects["first"].id).update(is_active=False)
    assert world.listed("first") is None
    assert world.listed("second") is not None

    StudentCohort.objects.filter(id=world.cohort.id).update(is_active=False)
    world.student.refresh_from_db()
    world.student.cohort = StudentCohort.objects.get(id=world.cohort.id)
    assert _client(world.student).get(DIRECTORY).json() == {"count": 0, "results": []}


def test_a_subject_without_a_source_node_is_listed_with_no_sheets() -> None:
    world = World()
    world.sheet("first", "Ready", ready=True)
    CatalogSubject.objects.filter(id=world.subjects["first"].id).update(source_node=None)

    listed = world.listed("first")

    assert listed is not None
    assert listed["sheets"] == []


def test_a_subject_with_a_single_document_and_one_with_many_both_list_completely() -> None:
    world = World()
    world.sheet("first", "Solo", ready=True)
    for index in range(6):
        world.sheet("second", f"Many {index}", ready=index % 2 == 0, position=index)

    assert [s["title"] for s in world.listed("first")["sheets"]] == ["Solo"]  # type: ignore[index]
    assert len(world.listed("second")["sheets"]) == 6  # type: ignore[index]


def test_sheets_with_similar_titles_keep_distinct_slugs_and_ids() -> None:
    world = World()
    world.sheet("first", "Sheet 1", ready=True, position=0)
    world.sheet("first", "Sheet 1", ready=False, position=1)

    listed = world.listed("first")

    assert listed is not None
    assert len({sheet["slug"] for sheet in listed["sheets"]}) == 2
    assert len({sheet["learningObjectId"] for sheet in listed["sheets"]}) == 2

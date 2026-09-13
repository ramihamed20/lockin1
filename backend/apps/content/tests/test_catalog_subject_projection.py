"""A subject is visible because a cohort owns it, never because it holds a sheet.

These cover the gap that made subjects vanish from students' Materials pages:
``CatalogSubject`` was written exactly once, by a migration, so every branch
configured afterwards had no row -- and the endpoint, which is otherwise
correct, has nothing to return for a branch that does not exist.

The existing suite could not catch it because every test created the branch rows
it then read back.  These start from the hierarchy instead.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.content.admin_services import create_sheet, is_student_visible
from apps.content.catalog_subjects import cohorts_without_branches, project_all
from apps.content.models import CatalogSubject, LearningObject
from apps.education.models import AcademicProgram, EducationNode, StudentCohort
from apps.education.services import create_node, set_node_status
from apps.education.tests.helpers import create_admin, pdf_upload
from apps.files.services import create_managed_file
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


# The projection runs on commit so it can never roll back the hierarchy edit
# that prompted it. Tests run inside a transaction that never commits, so they
# drain those callbacks explicitly, which is also the closest thing to the
# production path.
def _published(
    admin: User, *, parent: EducationNode | None, kind: str, title: str, position: int = 0
):
    node = create_node(actor=admin, parent=parent, kind=kind, title=title, position=position)
    return set_node_status(
        actor=admin,
        node_id=node.id,
        expected_revision=node.revision,
        status=EducationNode.Status.PUBLISHED,
    )


def _college(admin: User, *, code: str) -> EducationNode:
    """Only an institution may be a root node, so every branch starts with one."""

    institution = _published(
        admin, parent=None, kind=EducationNode.Kind.INSTITUTION, title=f"Universities {code}"
    )
    return _published(
        admin, parent=institution, kind=EducationNode.Kind.COLLEGE, title=f"City {code}"
    )


def _branch(admin: User, commit, *, code: str, subjects: tuple[str, ...], position: int = 1):
    """One college/year/subjects branch with a cohort attached to the year."""

    college = _college(admin, code=code)
    year = _published(admin, parent=college, kind=EducationNode.Kind.ACADEMIC_YEAR, title="Year 1")
    for order, title in enumerate(subjects, start=1):
        _published(
            admin,
            parent=year,
            kind=EducationNode.Kind.SUBJECT,
            title=title,
            position=order,
        )
    program = AcademicProgram.objects.create(
        code=f"program-{code}",
        name_en=f"Program {code}",
        name_ar=f"Program {code}",
        position=position,
    )
    cohort = StudentCohort.objects.create(
        program=program, code="year-1", name_en=f"Year 1 {code}", name_ar="Year 1"
    )
    with commit(execute=True):
        cohort.content_nodes.set([year])
    return year, cohort


def test_attaching_a_content_root_projects_every_subject_including_empty_ones(
    django_capture_on_commit_callbacks,
) -> None:
    admin = create_admin(email="projection-attach@example.com")
    _, cohort = _branch(
        admin,
        django_capture_on_commit_callbacks,
        code="a",
        subjects=("Anatomy", "Physiology", "Biochemistry"),
    )
    student = create_user(email="projection-attach-student@example.com", cohort=cohort)

    response = client_for(student).get("/api/v1/catalog/materials")

    assert response.status_code == 200
    body = response.json()
    assert [item["title"] for item in body["results"]] == ["Anatomy", "Physiology", "Biochemistry"]
    # The point of the whole exercise: no sheet has been published anywhere, and
    # all three subjects are still there.
    assert all(item["sheets"] == [] for item in body["results"])


def test_a_subject_added_after_the_cohort_exists_appears_without_a_sheet(
    django_capture_on_commit_callbacks,
) -> None:
    admin = create_admin(email="projection-late@example.com")
    year, cohort = _branch(
        admin, django_capture_on_commit_callbacks, code="b", subjects=("Anatomy",)
    )
    student = create_user(email="projection-late-student@example.com", cohort=cohort)

    with django_capture_on_commit_callbacks(execute=True):
        _published(
            admin,
            parent=year,
            kind=EducationNode.Kind.SUBJECT,
            title="Pharmacology",
            position=2,
        )

    response = client_for(student).get("/api/v1/catalog/materials")

    assert response.status_code == 200
    assert [item["title"] for item in response.json()["results"]] == ["Anatomy", "Pharmacology"]


def test_a_renamed_subject_keeps_its_route_and_takes_the_new_title(
    django_capture_on_commit_callbacks,
) -> None:
    admin = create_admin(email="projection-rename@example.com")
    year, _ = _branch(admin, django_capture_on_commit_callbacks, code="c", subjects=("Anatomy",))
    subject_node = EducationNode.objects.get(parent=year, kind=EducationNode.Kind.SUBJECT)
    branch = CatalogSubject.objects.get(source_node=subject_node)
    original_material_slug = branch.material_slug

    subject_node.title = "Gross Anatomy"
    with django_capture_on_commit_callbacks(execute=True):
        subject_node.save()

    branch.refresh_from_db()
    assert branch.title == "Gross Anatomy"
    # The route key is what a student's bookmark and saved workspace hang off.
    assert branch.material_slug == original_material_slug


def test_the_projection_never_reactivates_a_retired_branch(
    django_capture_on_commit_callbacks,
) -> None:
    admin = create_admin(email="projection-retired@example.com")
    year, _ = _branch(admin, django_capture_on_commit_callbacks, code="d", subjects=("Anatomy",))
    subject_node = EducationNode.objects.get(parent=year, kind=EducationNode.Kind.SUBJECT)
    CatalogSubject.objects.filter(source_node=subject_node).update(is_active=False)

    project_all()

    assert CatalogSubject.objects.get(source_node=subject_node).is_active is False


def test_the_projection_never_moves_a_branch_to_another_cohort(
    django_capture_on_commit_callbacks,
) -> None:
    admin = create_admin(email="projection-rehome@example.com")
    year, first = _branch(
        admin, django_capture_on_commit_callbacks, code="e", subjects=("Anatomy",), position=1
    )
    subject_node = EducationNode.objects.get(parent=year, kind=EducationNode.Kind.SUBJECT)
    # Sharing one content root between two cohorts is a misconfiguration: the
    # link is one-to-one. It has to resolve the same way every time rather than
    # moving a subject out from under the students who already see it.
    second_program = AcademicProgram.objects.create(
        code="program-e2", name_en="Program E2", name_ar="Program E2", position=2
    )
    second = StudentCohort.objects.create(
        program=second_program, code="year-1", name_en="Second", name_ar="Second"
    )
    with django_capture_on_commit_callbacks(execute=True):
        second.content_nodes.set([year])

    project_all()

    assert CatalogSubject.objects.get(source_node=subject_node).cohort_id == first.id


def test_publishing_outside_every_cohort_is_surfaced_and_never_announced() -> None:
    """Content outside the Catalog stays publishable, and stops pretending.

    A sheet under no cohort's content root reaches no student. That is a
    deliberate capability, so publishing is allowed -- but it used to also send
    every student a "New sheet available" notification for something none of them
    could open, and Content Studio showed it as plainly published.
    """

    admin = create_admin(email="projection-unowned@example.com")
    student = create_user(email="projection-unowned-student@example.com")
    college = _college(admin, code="unattached")
    year = _published(admin, parent=college, kind=EducationNode.Kind.ACADEMIC_YEAR, title="Year 1")
    subject = _published(admin, parent=year, kind=EducationNode.Kind.SUBJECT, title="Orphan")

    sheet = create_sheet(
        actor=admin,
        subject=subject,
        managed_file=create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf"),
        title="Invisible sheet",
        summary="",
        position=0,
        publish=True,
        notify_students=True,
        allow_download=False,
    )

    assert sheet.workflow_status == LearningObject.WorkflowStatus.PUBLISHED
    assert is_student_visible(sheet) is False
    assert not Notification.objects.filter(
        recipient=student, template_key="content.sheet_published"
    ).exists()


def test_a_student_visible_sheet_reports_itself_as_visible() -> None:
    admin = create_admin(email="projection-visible@example.com")
    college = _college(admin, code="visible")
    year = _published(admin, parent=college, kind=EducationNode.Kind.ACADEMIC_YEAR, title="Year 1")
    subject = _published(
        admin, parent=year, kind=EducationNode.Kind.SUBJECT, title="Anatomy", position=1
    )
    program = AcademicProgram.objects.create(
        code="program-visible", name_en="Visible", name_ar="Visible", position=1
    )
    cohort = StudentCohort.objects.create(
        program=program, code="year-1", name_en="Visible", name_ar="Visible"
    )
    cohort.content_nodes.set([year])

    sheet = create_sheet(
        actor=admin,
        subject=subject,
        managed_file=create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf"),
        title="Cranial nerves",
        summary="",
        position=0,
        publish=True,
        notify_students=False,
        allow_download=False,
    )

    assert is_student_visible(sheet) is True


def test_sheet_notification_only_targets_the_owning_cohort_with_a_valid_route() -> None:
    admin = create_admin(email="projection-notify@example.com")
    college = _college(admin, code="notify")
    year = _published(admin, parent=college, kind=EducationNode.Kind.ACADEMIC_YEAR, title="Year 1")
    subject = _published(admin, parent=year, kind=EducationNode.Kind.SUBJECT, title="Anatomy")
    program = AcademicProgram.objects.create(
        code="program-notify", name_en="Notify", name_ar="Notify"
    )
    own = StudentCohort.objects.create(program=program, code="own", name_en="Own", name_ar="Own")
    other = StudentCohort.objects.create(
        program=program, code="other", name_en="Other", name_ar="Other"
    )
    own.content_nodes.set([year])
    other.content_nodes.set([])
    own_student = create_user(email="projection-notify-own@example.com", cohort=own)
    other_student = create_user(email="projection-notify-other@example.com", cohort=other)

    sheet = create_sheet(
        actor=admin,
        subject=subject,
        managed_file=create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf"),
        title="Cranial nerves",
        summary="",
        position=0,
        publish=True,
        notify_students=True,
        allow_download=False,
    )

    document = sheet.published_version.catalog_document
    notification = Notification.objects.get(
        recipient=own_student, template_key="content.sheet_published"
    )
    assert notification.target_route == (
        f"/materials/catalog/{document.material_slug}/sheets/{document.sheet_slug}"
    )
    assert not Notification.objects.filter(
        recipient=other_student, template_key="content.sheet_published"
    ).exists()


def test_publishing_into_a_newly_added_subject_reaches_the_student(
    django_capture_on_commit_callbacks,
) -> None:
    admin = create_admin(email="projection-publish@example.com")
    year, cohort = _branch(
        admin, django_capture_on_commit_callbacks, code="f", subjects=("Anatomy",)
    )
    student = create_user(email="projection-publish-student@example.com", cohort=cohort)
    subject = _published(
        admin, parent=year, kind=EducationNode.Kind.SUBJECT, title="Histology", position=2
    )

    create_sheet(
        actor=admin,
        subject=subject,
        managed_file=create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf"),
        title="Epithelium",
        summary="",
        position=0,
        publish=True,
        notify_students=False,
        allow_download=False,
    )

    results = client_for(student).get("/api/v1/catalog/materials").json()["results"]
    histology = next(item for item in results if item["title"] == "Histology")
    assert [sheet["title"] for sheet in histology["sheets"]] == ["Epithelium"]


def test_a_cohort_with_no_content_root_is_reported_rather_than_guessed_at() -> None:
    program = AcademicProgram.objects.create(code="program-empty", name_en="Empty", name_ar="Empty")
    cohort = StudentCohort.objects.create(
        program=program, code="preparatory", name_en="Preparatory", name_ar="Preparatory"
    )
    student = create_user(email="projection-empty-student@example.com", cohort=cohort)

    assert cohort in cohorts_without_branches()
    # Reported, not invented: the endpoint still answers honestly.
    assert client_for(student).get("/api/v1/catalog/materials").json()["results"] == []

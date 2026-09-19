"""Admin content lists must not repeat the same query for every row.

The subject list used to run three COUNT queries (and an EXISTS) for every
subject, and the sheet list about eleven queries for every sheet. These tests
pin the batched shape so a new per-row lookup shows up as a failure.
"""

from __future__ import annotations

from typing import Any

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.admin_services import create_sheet
from apps.content.admin_views import _sheets
from apps.content.models import CatalogSubject
from apps.education.models import AcademicProgram, EducationNode, StudentCohort
from apps.education.services import create_node, set_node_status
from apps.education.tests.helpers import create_admin, pdf_upload, published_path
from apps.files.services import create_managed_file
from apps.progress.models import Bookmark

pytestmark = pytest.mark.django_db


def _sheet(*, admin: Any, subject: Any, title: str, publish: bool) -> Any:
    managed_file = create_managed_file(
        owner=admin,
        upload=pdf_upload(name=f"{title.lower().replace(' ', '-')}.pdf"),
        kind="pdf",
    )
    return create_sheet(
        actor=admin,
        subject=subject,
        managed_file=managed_file,
        title=title,
        summary="A managed lecture sheet.",
        position=1,
        publish=publish,
        notify_students=False,
        allow_download=False,
    )


def _query_count(client: APIClient, path: str) -> tuple[int, Any]:
    client.get(path)
    with CaptureQueriesContext(connection) as context:
        response = client.get(path)
    assert response.status_code == 200, response.content
    return len(context.captured_queries), response.json()


def test_sheet_list_query_count_stays_within_a_per_row_budget() -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    client = APIClient()
    client.force_authenticate(admin)
    path = f"/api/v1/operations/admin/content/subjects/{subject.id}/sheets"

    _sheet(admin=admin, subject=subject, title="Sheet 1", publish=True)
    one, _ = _query_count(client, path)
    for number in range(2, 7):
        _sheet(admin=admin, subject=subject, title=f"Sheet {number}", publish=number % 2 == 0)
    many, body = _query_count(client, path)

    assert body["count"] == 6
    # Counts, history and summary visibility are batched for the whole list.
    # What still runs per row is edition and Active Study settings resolution,
    # which is shared with the student reader and deliberately left alone.
    per_row = (many - one) / 5
    assert per_row <= 5, f"{one} queries for one sheet, {many} for six"


def test_batched_sheet_facts_match_the_single_sheet_serializer() -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    draft = _sheet(admin=admin, subject=subject, title="Draft sheet", publish=False)
    published = _sheet(admin=admin, subject=subject, title="Published sheet", publish=True)
    bookmarked = _sheet(admin=admin, subject=subject, title="Bookmarked", publish=False)
    Bookmark.objects.create(user=admin, learning_object=bookmarked)

    client = APIClient()
    client.force_authenticate(admin)
    listed = {
        row["id"]: row
        for row in client.get(
            f"/api/v1/operations/admin/content/subjects/{subject.id}/sheets"
        ).json()["results"]
    }
    for sheet in _sheets(subject):
        # The detail route still serializes one sheet with the original queries.
        single = client.get(f"/api/v1/operations/admin/content/sheets/{sheet.id}").json()
        assert listed[str(sheet.id)] == single, sheet.id

    assert listed[str(draft.id)]["can_permanently_delete"] is True
    assert listed[str(published.id)]["can_permanently_delete"] is False
    assert listed[str(bookmarked.id)]["can_permanently_delete"] is False


def test_subject_list_query_count_does_not_grow_with_subjects() -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    program = AcademicProgram.objects.create(code="budget", name_en="Budget", name_ar="Budget")
    cohort = StudentCohort.objects.create(
        program=program, code="year-1", name_en="Budget Year 1", name_ar="Budget Year 1"
    )
    client = APIClient()
    client.force_authenticate(admin)
    path = "/api/v1/operations/admin/content/subjects"

    def add_branch(node: EducationNode, number: int) -> None:
        CatalogSubject.objects.create(
            cohort=cohort,
            source_node=node,
            title=f"Subject {number}",
            slug=f"subject-{number}",
            material_slug=f"budget-subject-{number}",
        )
        _sheet(admin=admin, subject=node, title=f"Budget sheet {number}", publish=number % 2 == 0)

    add_branch(subject, 0)
    one, first = _query_count(client, path)
    for number in range(1, 5):
        node = create_node(
            actor=admin,
            parent=subject.parent,
            kind=EducationNode.Kind.SUBJECT,
            title=f"Subject node {number}",
        )
        node = set_node_status(
            actor=admin,
            node_id=node.id,
            expected_revision=node.revision,
            status=EducationNode.Status.PUBLISHED,
        )
        add_branch(node, number)
    many, body = _query_count(client, path)

    assert body["count"] == first["count"] + 4
    # Every count must equal the per-subject queries the list used to run.
    for row in body["results"]:
        sheets = _sheets(CatalogSubject.objects.get(id=row["id"]).source_node)
        assert row["sheet_count"] == sheets.count(), row["title"]
        assert row["published_count"] == sheets.filter(workflow_status="published").count()
        assert (
            row["draft_count"]
            == sheets.filter(workflow_status__in=("draft", "in_review", "rejected")).count()
        )
    assert {row["published_count"] for row in body["results"]} >= {0, 1}
    assert many <= one, f"{one} queries for one subject, {many} for five"


def test_student_materials_directory_query_growth_per_sheet() -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    program = AcademicProgram.objects.create(code="dir", name_en="Dir", name_ar="Dir")
    cohort = StudentCohort.objects.create(program=program, code="own", name_en="Own", name_ar="Own")
    cohort.content_nodes.add(subject)
    CatalogSubject.objects.create(
        cohort=cohort,
        source_node=subject,
        title="Directory subject",
        slug="directory-subject",
        material_slug="dir-own-directory-subject",
    )
    student = create_user(email="directory-student@example.com", cohort=cohort)
    client = APIClient()
    client.force_authenticate(student)
    path = "/api/v1/catalog/materials"

    _sheet(admin=admin, subject=subject, title="Directory sheet 1", publish=True)
    one, _ = _query_count(client, path)
    for number in range(2, 7):
        _sheet(admin=admin, subject=subject, title=f"Directory sheet {number}", publish=True)
    many, body = _query_count(client, path)

    assert len(body["results"][0]["sheets"]) == 6
    # Measured at 12 queries for one sheet and 17 for six: Active Study
    # readiness is resolved per sheet. Keep it from growing further.
    assert (many - one) / 5 <= 1.5, f"{one} queries for one sheet, {many} for six"

from uuid import uuid4

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.audit.models import AuditRecord
from apps.content.models import (
    CatalogDocument,
    LearningObjectAsset,
    LearningObjectVersion,
    SavedStudyAssistanceIdea,
    StudyAssistanceIdea,
)

from .test_catalog_workspace import catalog_fixture, client_for, grant_focus

pytestmark = pytest.mark.django_db


@pytest.fixture
def context():  # type: ignore[no-untyped-def]
    document, cohort, other = catalog_fixture()
    document.version.page_count = 3
    document.version.save(update_fields=("page_count",))
    document.managed_file.pdf_page_count = 3
    document.managed_file.save(update_fields=("pdf_page_count",))
    user = create_user(email="assistance-reader@example.com", cohort=cohort)
    grant_focus(user)
    return document, user, cohort, other


def idea(document: CatalogDocument, **changes):  # type: ignore[no-untyped-def]
    return StudyAssistanceIdea.objects.create(
        source_version=document.version,
        **{
            "page": 1,
            "teaser": "A way to understand this page",
            "question": "What is the main idea?",
            "explanation": "The explanation for this specific page.",
            "followup_question": "Can you recall it?",
            "followup_answer": "The reviewed answer.",
            "is_published": True,
            **changes,
        },
    )


def url(document: CatalogDocument) -> str:
    return f"/api/v1/catalog/documents/{document.id}/assistance"


def saved_url(document: CatalogDocument, row: StudyAssistanceIdea) -> str:
    return f"{url(document)}/{row.id}/saved"


def admin_url(document: CatalogDocument) -> str:
    return (
        f"/api/v1/operations/admin/content/sheets/{document.version.learning_object_id}/assistance"
    )


def test_reader_receives_only_published_current_page_and_sheet_wide_ideas(context) -> None:
    document, user, _, _ = context
    current = idea(document)
    general = idea(document, page=None, position=1)
    idea(document, is_published=False)
    idea(document, page=999)
    client = client_for(user)
    response = client.get(url(document), {"page": 1})
    assert response.status_code == 200
    assert [r["id"] for r in response.json()["results"]] == [str(current.id), str(general.id)]
    assert response["Cache-Control"] == "private, no-store"
    assert response.json()["results"][0]["saved"] is False
    for query in ({}, {"page": 0}, {"page": 999}):
        assert client.get(url(document), query).status_code == 400


def test_edition_view_and_version_are_independent(context) -> None:
    document, user, _, _ = context
    university = idea(document)
    for role in ("lockin_primary", "summary"):
        LearningObjectAsset.objects.create(
            version=document.version, managed_file=document.managed_file, role=role
        )
    lockin_document = CatalogDocument.objects.create(
        version=document.version,
        managed_file=document.managed_file,
        material_slug=document.material_slug,
        sheet_slug="cranial-nerves-lockin",
        edition="lockin",
    )
    lockin = idea(document, edition="lockin")
    summary = idea(document, view="summary")
    v = document.version
    values = {
        field.attname: getattr(v, field.attname)
        for field in LearningObjectVersion._meta.concrete_fields
        if not field.primary_key and field.name not in ("created_at", "version_number")
    }
    old = LearningObjectVersion.objects.create(**values, version_number=99)
    stale = idea(document)
    stale.source_version = old
    stale.save(update_fields=("source_version",))
    client = client_for(user)
    assert [r["id"] for r in client.get(url(document), {"page": 1}).json()["results"]] == [
        str(university.id)
    ]
    assert [r["id"] for r in client.get(url(lockin_document), {"page": 1}).json()["results"]] == [
        str(lockin.id)
    ]
    assert [
        r["id"] for r in client.get(url(document), {"page": 1, "view": "summary"}).json()["results"]
    ] == [str(summary.id)]
    assert (
        client.put(saved_url(document, lockin), {"saved": True}, format="json").status_code == 404
    )


def test_unknown_pdf_count_allows_only_sheet_wide_help(context) -> None:
    document, user, _, _ = context
    general = idea(document, page=None)
    idea(document, page=1)
    document.version.page_count = None
    document.version.save(update_fields=("page_count",))
    document.managed_file.pdf_page_count = None
    document.managed_file.save(update_fields=("pdf_page_count",))
    response = client_for(user).get(url(document), {"page": 1})
    assert response.status_code == 200, response.content
    assert [row["id"] for row in response.json()["results"]] == [str(general.id)]


def test_saves_are_idempotent_per_student_and_unpublished_ideas_disappear(context) -> None:
    document, user, cohort, _ = context
    row = idea(document)
    client = client_for(user)
    for _ in range(2):
        saved = client.put(saved_url(document, row), {"saved": True}, format="json")
        assert saved.status_code == 200 and saved.json()["idea"]["saved"] is True
    assert SavedStudyAssistanceIdea.objects.count() == 1
    stranger = create_user(email="assistance-stranger@example.com", cohort=cohort)
    grant_focus(stranger)
    assert client_for(stranger).get(url(document), {"saved": True}).json()["results"] == []
    assert len(client.get(url(document), {"saved": True}).json()["results"]) == 1
    row.is_published = False
    row.save(update_fields=("is_published",))
    assert client.get(url(document), {"saved": True}).json()["results"] == []
    assert client.put(saved_url(document, row), {"saved": True}, format="json").status_code == 404


def test_unsave_does_not_touch_another_students_save(context) -> None:
    document, user, cohort, _ = context
    row = idea(document)
    other = create_user(email="assistance-second@example.com", cohort=cohort)
    grant_focus(other)
    SavedStudyAssistanceIdea.objects.create(user=other, idea=row)
    client = client_for(user)
    assert client.put(saved_url(document, row), {"saved": True}, format="json").status_code == 200
    assert client.put(saved_url(document, row), {"saved": False}, format="json").status_code == 200
    assert list(SavedStudyAssistanceIdea.objects.values_list("user_id", flat=True)) == [other.id]


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_catalog_entitlement_cohort_authentication_and_csrf_are_preserved(context) -> None:
    document, user, cohort, other_cohort = context
    row = idea(document)
    outsider = create_user(email="assistance-outside@example.com", cohort=other_cohort)
    grant_focus(outsider)
    assert client_for(outsider).get(url(document), {"page": 1}).status_code in (403, 404)
    no_grant = create_user(email="assistance-no-grant@example.com", cohort=cohort, verified=False)
    assert client_for(no_grant).get(url(document), {"page": 1}).status_code == 403
    assert APIClient().get(url(document), {"page": 1}).status_code in (401, 403)
    csrf_client = APIClient(enforce_csrf_checks=True)
    csrf_client.force_login(user)
    response = csrf_client.put(saved_url(document, row), {"saved": True}, format="json")
    assert response.status_code == 403 and b"CSRF" in response.content


def test_admin_authors_publishes_and_updates_with_revision_and_source_guards(context) -> None:
    document, user, _, _ = context
    client = client_for(document.version.learning_object.owner)
    data = {
        "source_version_id": str(document.version_id),
        "page": 1,
        "teaser": "Understand this point",
        "question": "A specific question?",
        "explanation": "A reviewed explanation.",
        "followup_question": "Another related question?",
        "followup_answer": "Its reviewed answer.",
    }
    assert client_for(user).post(admin_url(document), data, format="json").status_code == 403
    created = client.post(admin_url(document), data, format="json")
    assert created.status_code == 201, created.content
    row = created.json()["idea"]
    assert row["is_published"] is False
    assert client_for(user).get(url(document), {"page": 1}).json()["results"] == []
    path = f"{admin_url(document)}/{row['id']}"
    patch = {
        "source_version_id": str(document.version_id),
        "expected_revision": 1,
        "is_published": True,
    }
    published = client.patch(path, patch, format="json")
    assert published.status_code == 200 and published.json()["idea"]["revision"] == 2
    assert len(client_for(user).get(url(document), {"page": 1}).json()["results"]) == 1
    assert client.patch(path, patch, format="json").status_code == 409
    assert AuditRecord.objects.filter(action="content.study_assistance_created").count() == 1
    assert client.get(admin_url(document)).json()["results"][0]["id"] == row["id"]
    for bad in (
        {"page": 0},
        {"page": 999},
        {"edition": "unknown"},
        {"view": "unknown"},
        {"explanation": " "},
    ):
        response = client.post(admin_url(document), {**data, **bad}, format="json")
        assert response.status_code == 400, response.content
    assert (
        client.post(
            admin_url(document), {**data, "source_version_id": str(uuid4())}, format="json"
        ).status_code
        == 409
    )

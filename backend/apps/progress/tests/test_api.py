import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, published_path

pytestmark = pytest.mark.django_db


def test_progress_and_bookmark_api_round_trip() -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
    _, _, lesson = published_path(admin=admin)
    content = published_pdf(actor=admin, node=lesson)
    client = APIClient()
    client.force_authenticate(student)

    bookmark = client.post(
        "/api/v1/bookmarks",
        {"learning_object_id": str(content.id)},
        format="json",
    )
    progress = client.put(
        f"/api/v1/progress/learning-objects/{content.id}",
        {
            "expected_revision": 0,
            "status": "in_progress",
            "completion_percent": 20,
            "position": {"page": 3},
        },
        format="json",
    )
    dashboard = client.get("/api/v1/learning/dashboard")

    assert bookmark.status_code == 201
    assert progress.status_code == 200
    assert progress.json()["position"] == {"page": 3}
    assert dashboard.status_code == 200
    assert dashboard.json()["next_item"]["learning_object_id"] == str(content.id)
    assert dashboard.json()["next_item"]["focus_document_version_id"] == str(
        content.published_version_id
    )


def test_stale_progress_update_returns_conflict() -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
    _, _, lesson = published_path(admin=admin)
    content = published_pdf(actor=admin, node=lesson)
    client = APIClient()
    client.force_authenticate(student)
    payload = {
        "expected_revision": 0,
        "status": "in_progress",
        "completion_percent": 10,
        "position": {"page": 2},
    }

    first = client.put(f"/api/v1/progress/learning-objects/{content.id}", payload, format="json")
    stale = client.put(f"/api/v1/progress/learning-objects/{content.id}", payload, format="json")

    assert first.status_code == 200
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "revision_conflict"


def test_bookmark_resume_and_lesson_completion_endpoints() -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
    _, _, lesson = published_path(admin=admin)
    content = published_pdf(actor=admin, node=lesson)
    client = APIClient()
    client.force_authenticate(student)

    initial = client.get(f"/api/v1/progress/learning-objects/{content.id}")
    assert initial.status_code == 200
    assert initial.json()["revision"] == 0
    first_bookmark = client.post(
        "/api/v1/bookmarks", {"learning_object_id": str(content.id)}, format="json"
    )
    second_bookmark = client.post(
        "/api/v1/bookmarks", {"learning_object_id": str(content.id)}, format="json"
    )
    assert first_bookmark.status_code == 201
    assert second_bookmark.status_code == 200
    assert client.get("/api/v1/bookmarks").json()["count"] == 1

    client.put(
        f"/api/v1/progress/learning-objects/{content.id}",
        {
            "expected_revision": 0,
            "status": "in_progress",
            "completion_percent": 35,
            "position": {"page": 5},
        },
        format="json",
    )
    resume = client.get("/api/v1/progress/resume")
    assert resume.status_code == 200
    assert resume.json()["count"] == 1
    assert resume.json()["results"][0]["focus_document_version_id"] == str(
        content.published_version_id
    )

    completed = client.post(
        f"/api/v1/progress/lessons/{lesson.id}/complete",
        {"expected_revision": 0},
        format="json",
    )
    stale = client.post(
        f"/api/v1/progress/lessons/{lesson.id}/complete",
        {"expected_revision": 0},
        format="json",
    )
    assert completed.status_code == 200
    assert stale.status_code == 409
    assert client.delete(f"/api/v1/bookmarks/{content.id}").status_code == 204


def test_catalog_bookmark_round_trip_is_user_scoped_and_persistent() -> None:
    student = create_user(with_trial=True)
    other_student = create_user(email="other-bookmarks@example.com", with_trial=True)
    client = APIClient()
    client.force_authenticate(student)
    payload = {
        "catalog_material_slug": "oral-histology",
        "catalog_material_title": "Oral Histology",
        "catalog_sheet_slug": "enamel-structure",
        "catalog_sheet_title": "Enamel Structure",
        "position": {"page": 7, "zoom": 1.25},
    }

    created = client.post("/api/v1/bookmarks", payload, format="json")
    detail_url = "/api/v1/bookmarks/catalog/oral-histology/enamel-structure"

    assert created.status_code == 201
    assert created.json()["learning_object"] is None
    assert created.json()["position"] == {"page": 7, "zoom": 1.25}
    assert client.get(detail_url).status_code == 200
    listed = client.get("/api/v1/bookmarks").json()
    assert listed["count"] == 1
    assert listed["results"][0]["catalog_sheet_title"] == "Enamel Structure"

    other_client = APIClient()
    other_client.force_authenticate(other_student)
    assert other_client.get(detail_url).status_code == 404

    assert client.delete(detail_url).status_code == 204
    assert client.get(detail_url).status_code == 404


def test_progress_rejects_missing_content_and_invalid_pdf_position() -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
    _, _, lesson = published_path(admin=admin)
    content = published_pdf(actor=admin, node=lesson)
    client = APIClient()
    client.force_authenticate(student)

    missing_bookmark = client.post(
        "/api/v1/bookmarks",
        {"learning_object_id": "00000000-0000-0000-0000-000000000001"},
        format="json",
    )
    invalid_position = client.put(
        f"/api/v1/progress/learning-objects/{content.id}",
        {
            "expected_revision": 0,
            "status": "in_progress",
            "completion_percent": 10,
            "position": {"page": 0},
        },
        format="json",
    )

    assert missing_bookmark.status_code == 400
    assert invalid_position.status_code == 400
    assert invalid_position.json()["error"]["code"] == "progress_rule_rejected"

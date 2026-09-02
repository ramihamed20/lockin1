import pytest
from pytest_django.fixtures import DjangoAssertNumQueries
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.tests.helpers import create_admin, create_creator, pdf_upload, published_path
from apps.files.services import create_managed_file

from .helpers import published_pdf

pytestmark = pytest.mark.django_db


def test_students_never_receive_drafts() -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
    _, _, lesson = published_path(admin=admin)
    published = published_pdf(actor=admin, node=lesson)
    from apps.content.services import LearningObjectInput, create_learning_object

    create_learning_object(
        actor=admin,
        data=LearningObjectInput(
            academic_node=lesson,
            content_type="video",
            title="Private draft",
        ),
    )
    client = APIClient()
    client.force_authenticate(student)

    response = client.get(f"/api/v1/learning-objects?node={lesson.id}")

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["results"][0]["id"] == str(published.id)
    assert response.json()["results"][0]["version"]["focus_context"]["context_type"] == "study"


def test_management_endpoint_rejects_student_content_creation() -> None:
    student = create_user(with_trial=True)
    client = APIClient()
    client.force_authenticate(student)

    response = client.post(
        "/api/v1/management/content",
        {
            "academic_node_id": "00000000-0000-0000-0000-000000000001",
            "content_type": "video",
            "title": "Injected",
        },
        format="json",
    )

    assert response.status_code == 403


def test_administrator_runs_versioned_content_workflow_through_api() -> None:
    admin = create_admin()
    new_owner = create_creator()
    _, _, lesson = published_path(admin=admin)
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")
    client = APIClient()
    client.force_authenticate(admin)
    payload = {
        "academic_node_id": str(lesson.id),
        "content_type": "pdf",
        "title": "Cranial nerves workbook",
        "summary": "Versioned study material",
        "language": "en",
        "allow_download": True,
        "metadata": {"estimated_minutes": 25},
        "primary_file_id": str(managed_file.id),
    }

    created_response = client.post("/api/v1/management/content", payload, format="json")
    assert created_response.status_code == 201
    created = created_response.json()
    object_id = created["id"]
    listing = client.get("/api/v1/management/content?page_size=100")
    detail = client.get(f"/api/v1/management/content/{object_id}")
    assert listing.status_code == detail.status_code == 200
    assert listing.json()["count"] == 1

    revised_response = client.patch(
        f"/api/v1/management/content/{object_id}",
        {
            **payload,
            "title": "Cranial nerves workbook, revised",
            "expected_revision": created["revision"],
        },
        format="json",
    )
    assert revised_response.status_code == 200
    revised = revised_response.json()
    assert revised["current_version"]["version_number"] == 2

    submitted_response = client.post(
        f"/api/v1/management/content/{object_id}/submit",
        {"expected_revision": revised["revision"]},
        format="json",
    )
    assert submitted_response.status_code == 200
    submitted = submitted_response.json()
    rejected_response = client.post(
        f"/api/v1/management/content/{object_id}/reject",
        {"expected_revision": submitted["revision"], "review_note": "Clarify landmark labels."},
        format="json",
    )
    assert rejected_response.status_code == 200
    rejected = rejected_response.json()
    assert rejected["workflow_status"] == "rejected"

    final_draft_response = client.patch(
        f"/api/v1/management/content/{object_id}",
        {
            **payload,
            "title": "Cranial nerves mastery guide",
            "expected_revision": rejected["revision"],
        },
        format="json",
    )
    final_draft = final_draft_response.json()
    final_review_response = client.post(
        f"/api/v1/management/content/{object_id}/submit",
        {"expected_revision": final_draft["revision"]},
        format="json",
    )
    published_response = client.post(
        f"/api/v1/management/content/{object_id}/publish",
        {"expected_revision": final_review_response.json()["revision"]},
        format="json",
    )
    assert published_response.status_code == 200
    published = published_response.json()
    public_detail = client.get(f"/api/v1/learning-objects/{object_id}")
    assert public_detail.status_code == 200
    assert public_detail.json()["version"]["title"] == "Cranial nerves mastery guide"

    transferred_response = client.post(
        f"/api/v1/management/content/{object_id}/transfer",
        {
            "expected_revision": published["revision"],
            "owner_id": str(new_owner.id),
        },
        format="json",
    )
    assert transferred_response.status_code == 200
    archived_response = client.post(
        f"/api/v1/management/content/{object_id}/archive",
        {"expected_revision": transferred_response.json()["revision"]},
        format="json",
    )
    assert archived_response.status_code == 200
    assert archived_response.json()["workflow_status"] == "archived"


def test_future_video_metadata_cannot_be_published() -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    client = APIClient()
    client.force_authenticate(admin)
    created = client.post(
        "/api/v1/management/content",
        {
            "academic_node_id": str(lesson.id),
            "content_type": "video",
            "title": "Future video lesson",
        },
        format="json",
    ).json()
    submitted = client.post(
        f"/api/v1/management/content/{created['id']}/submit",
        {"expected_revision": created["revision"]},
        format="json",
    ).json()

    blocked = client.post(
        f"/api/v1/management/content/{created['id']}/publish",
        {"expected_revision": submitted["revision"]},
        format="json",
    )

    assert blocked.status_code == 400
    assert blocked.json()["error"]["code"] == "content_rule_rejected"


def test_public_content_list_query_count_is_bounded(
    django_assert_max_num_queries: DjangoAssertNumQueries,
) -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
    _, _, lesson = published_path(admin=admin)
    for index in range(4):
        published_pdf(actor=admin, node=lesson, title=f"Study guide {index}")
    client = APIClient()
    client.force_authenticate(student)

    with django_assert_max_num_queries(10):
        response = client.get(f"/api/v1/learning-objects?node={lesson.id}&page_size=25")

    assert response.status_code == 200
    assert response.json()["count"] == 4

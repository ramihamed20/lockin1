import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.tests.helpers import published_pdf
from apps.education.models import EducationNode
from apps.education.services import set_node_status
from apps.education.tests.helpers import create_admin, published_path
from apps.review.models import ReviewItem

from ..indexing import upsert_search_entry
from ..result_service import global_search
from ..selectors import search

pytestmark = pytest.mark.django_db


def test_search_unifies_subject_lesson_and_learning_objects_with_filters() -> None:
    admin = create_admin()
    _, subject, lesson = published_path(admin=admin)
    content = published_pdf(actor=admin, node=lesson)

    assert list(
        search(query="human", resource_kinds=("subject",)).values_list("resource_id", flat=True)
    ) == [subject.id]
    assert list(search(query="cranial nerves guide").values_list("resource_id", flat=True)) == [
        content.id
    ]
    assert list(
        search(query="nerves", content_types=("pdf",)).values_list("resource_id", flat=True)
    ) == [content.id]


def test_archived_parent_removes_descendants_and_content_from_search() -> None:
    admin = create_admin()
    _, subject, lesson = published_path(admin=admin)
    content = published_pdf(actor=admin, node=lesson)

    set_node_status(
        actor=admin,
        node_id=subject.id,
        expected_revision=subject.revision,
        status=EducationNode.Status.ARCHIVED,
    )

    assert not search(query="cranial").filter(resource_id__in=(lesson.id, content.id)).exists()


def test_search_api_returns_compact_student_results_and_requires_authentication() -> None:
    admin = create_admin()
    student = create_user(with_trial=True)
    _, subject, _ = published_path(admin=admin)
    anonymous = APIClient()
    client = APIClient()
    client.force_authenticate(student)

    assert anonymous.get("/api/v1/search?q=human").status_code == 403
    response = client.get("/api/v1/search?q=human&kinds=subject")

    assert response.status_code == 200
    assert response.json()["count"] == 1
    result = response.json()["results"][0]
    assert result == {
        "title": "Human Anatomy",
        "subtitle": "",
        "type": "subject",
        "destination": f"/materials/{subject.id}",
        "metadata": {},
    }
    assert "resource_id" not in result


def test_global_search_ranks_exact_title_before_related_titles() -> None:
    student = create_user(with_trial=True)
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    exact = published_pdf(actor=admin, node=lesson, title="Cell")
    starts_with = published_pdf(actor=admin, node=lesson, title="Cellular Biology Introduction")
    related = published_pdf(actor=admin, node=lesson, title="Histology overview")
    upsert_search_entry(
        resource_kind="learning_object",
        resource_id=related.id,
        title="Histology overview",
        summary="Cell structure and tissue review.",
        academic_path=lesson.path,
        language="en",
        content_type="pdf",
    )

    results = global_search(user=student, query="cell", limit=12)

    assert [result["title"] for result in results[:3]] == [
        exact.published_version.title,
        starts_with.published_version.title,
        related.published_version.title,
    ]


def test_search_includes_only_the_current_users_active_review_items() -> None:
    student = create_user(with_trial=True)
    client = APIClient()
    client.force_authenticate(student)
    attempt = {
        "idempotency_key": "5cb6f644-d146-42e7-b9e5-65ca2ea3ccbb",
        "question_key": "demo:oral-pathology:sheet-4:q18",
        "subject_key": "catalog:oral-pathology",
        "subject_label": "Oral Pathology",
        "source_type": "sheet",
        "source_id": "oral-pathology:sheet-4",
        "source_label": "Sheet 4",
        "source_question_index": 18,
        "prompt": "What is the most common site of oral cancer?",
        "explanation": "Review the original sheet explanation.",
        "options": [{"id": "x", "text": "Incorrect"}, {"id": "y", "text": "Correct"}],
        "selected_option_ids": ["x"],
        "correct_option_ids": ["y"],
    }
    assert client.post("/api/v1/question-attempts", attempt, format="json").status_code == 201

    active = client.get("/api/v1/search?q=oral+cancer")
    assert active.status_code == 200
    assert active.json()["results"] == [
        {
            "title": "What is the most common site of oral cancer?",
            "subtitle": "Oral Pathology",
            "type": "review",
            "destination": "/review/bank/catalog%3Aoral-pathology",
            "metadata": {},
        }
    ]

    ReviewItem.objects.filter(user=student).update(state=ReviewItem.State.HIDDEN)
    assert client.get("/api/v1/search?q=oral+cancer").json()["results"] == []

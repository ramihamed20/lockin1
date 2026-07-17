import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.tests.helpers import published_pdf
from apps.education.models import EducationNode
from apps.education.services import set_node_status
from apps.education.tests.helpers import create_admin, published_path

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


def test_search_api_is_paginated_and_requires_authentication() -> None:
    admin = create_admin()
    student = create_user()
    published_path(admin=admin)
    anonymous = APIClient()
    client = APIClient()
    client.force_authenticate(student)

    assert anonymous.get("/api/v1/search?q=human").status_code == 403
    response = client.get("/api/v1/search?q=human&kinds=subject")

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["results"][0]["resource_kind"] == "subject"

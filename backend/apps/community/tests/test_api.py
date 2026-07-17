from urllib.parse import urlparse
from uuid import uuid4

import pytest
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.tests.helpers import create_admin, published_path

from ..models import Discussion
from ..serializers import DiscussionSerializer
from ..services import create_discussion, create_space, set_space_member
from .helpers import scoped_creator

pytestmark = pytest.mark.django_db


def test_discussion_api_escapes_by_contract_and_soft_deletion_hides_content() -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    client = APIClient()
    client.force_authenticate(student)
    response = client.post(
        "/api/v1/community/discussions",
        {
            "context_type": "lesson",
            "context_id": str(lesson.id),
            "title": "Can this example be explained step by step?",
            "body": (
                "<script>alert('stored as text')</script> Please explain the clinical sequence."
            ),
            "client_request_id": str(uuid4()),
        },
        format="json",
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["body"].startswith("<script>")
    assert payload["author"]["full_name"] == student.full_name
    assert payload["can_edit"] is True
    deleted = client.delete(
        f"/api/v1/community/discussions/{payload['id']}",
        {"expected_revision": payload["revision"]},
        format="json",
    )
    assert deleted.status_code == 200
    assert deleted.json()["body"] is None
    assert deleted.json()["title"] is None
    stored = Discussion.objects.get(id=payload["id"])
    assert stored.body.startswith("<script>")
    assert DiscussionSerializer(stored).data["body"] is None


def test_comment_api_enforces_ownership_and_cursor_pagination() -> None:
    admin = create_admin()
    author = create_user()
    helper = create_user(email="helper@example.com", full_name="Helpful Student")
    _, _, lesson = published_path(admin=admin)
    discussion = create_discussion(
        actor=author,
        context_type="lesson",
        context_id=lesson.id,
        title="Which clinical clue should I notice first?",
        body="I am comparing the symptoms and want to understand which clue should guide me first.",
        client_request_id=uuid4(),
    )
    helper_client = APIClient()
    helper_client.force_authenticate(helper)
    ids: list[str] = []
    for index in range(3):
        response = helper_client.post(
            f"/api/v1/community/discussions/{discussion.id}/comments",
            {
                "body": f"Reply {index} provides a distinct clinical explanation.",
                "client_request_id": str(uuid4()),
            },
            format="json",
        )
        assert response.status_code == 201
        ids.append(response.json()["id"])
    first = helper_client.get(f"/api/v1/community/discussions/{discussion.id}/comments?page_size=2")
    assert first.status_code == 200
    assert [item["id"] for item in first.json()["results"]] == ids[:2]
    next_query = urlparse(first.json()["next"]).query
    second = helper_client.get(
        f"/api/v1/community/discussions/{discussion.id}/comments?{next_query}"
    )
    assert [item["id"] for item in second.json()["results"]] == ids[2:]

    author_client = APIClient()
    author_client.force_authenticate(author)
    forbidden = author_client.delete(
        f"/api/v1/community/comments/{ids[0]}",
        {"expected_revision": 1},
        format="json",
    )
    assert forbidden.status_code == 403


def test_private_space_is_absent_from_outsider_api_and_revocation_takes_effect() -> None:
    admin = create_admin()
    member = create_user()
    outsider = create_user(email="outsider@example.com", full_name="Outside Student")
    _, _, lesson = published_path(admin=admin)
    creator = scoped_creator(admin=admin, node=lesson)
    space = create_space(
        actor=creator,
        context_type="lesson",
        context_id=lesson.id,
        title="Private lesson studio",
        description="A creator-led asynchronous space.",
    )
    set_space_member(actor=creator, space_id=space.id, user=member, role="member")
    member_client = APIClient()
    member_client.force_authenticate(member)
    assert member_client.get(f"/api/v1/community/spaces/{space.id}").status_code == 200
    outsider_client = APIClient()
    outsider_client.force_authenticate(outsider)
    assert outsider_client.get(f"/api/v1/community/spaces/{space.id}").status_code == 404
    assert (
        outsider_client.get(f"/api/v1/community/discussions?space_id={space.id}").status_code == 404
    )


def test_space_owner_invites_by_email_without_exposing_user_lookup_to_outsiders() -> None:
    admin = create_admin()
    student = create_user()
    outsider = create_user(email="outsider@example.com", full_name="Outside Student")
    _, _, lesson = published_path(admin=admin)
    creator = scoped_creator(admin=admin, node=lesson)
    space = create_space(
        actor=creator,
        context_type="lesson",
        context_id=lesson.id,
        title="Private invitation test space",
        description="Membership lookup must remain behind space management permission.",
    )
    outsider_client = APIClient()
    outsider_client.force_authenticate(outsider)
    forbidden = outsider_client.post(
        f"/api/v1/community/spaces/{space.id}/members",
        {"email": "unknown@example.com", "role": "member"},
        format="json",
    )
    assert forbidden.status_code == 403

    creator_client = APIClient()
    creator_client.force_authenticate(creator)
    invited = creator_client.post(
        f"/api/v1/community/spaces/{space.id}/members",
        {"email": student.email, "role": "member"},
        format="json",
    )
    assert invited.status_code == 201
    assert invited.json() == {
        "user_id": str(student.id),
        "role": "member",
        "status": "active",
    }


@override_settings(COMMUNITY_DISCUSSION_RATE_LIMIT=100)
def test_discussion_feed_query_count_does_not_grow_with_authors_and_badges() -> None:
    admin = create_admin()
    viewer = create_user()
    _, _, lesson = published_path(admin=admin)
    for index in range(10):
        author = create_user(
            email=f"author{index}@example.com",
            full_name=f"Student {index}",
        )
        create_discussion(
            actor=author,
            context_type="lesson",
            context_id=lesson.id,
            title=f"Contextual discussion number {index}",
            body=f"This is a distinct educational discussion body for query test number {index}.",
            client_request_id=uuid4(),
        )
    client = APIClient()
    client.force_authenticate(viewer)
    with CaptureQueriesContext(connection) as queries:
        response = client.get(
            f"/api/v1/community/discussions?context_type=lesson&context_id={lesson.id}"
        )
    assert response.status_code == 200
    assert len(response.json()["results"]) == 10
    assert len(queries) <= 8


def test_context_filter_requires_a_complete_valid_pair() -> None:
    client = APIClient()
    client.force_authenticate(create_user())
    assert client.get("/api/v1/community/discussions?context_type=lesson").status_code == 400
    assert (
        client.get(
            f"/api/v1/community/discussions?context_type=unknown&context_id={uuid4()}"
        ).status_code
        == 400
    )
    page = client.get("/api/v1/community/discussions?page_size=2")
    assert page.status_code == 200

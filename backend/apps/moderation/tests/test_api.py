from uuid import uuid4

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.community.models import Discussion, SpaceMembership
from apps.community.services import create_discussion, create_space, set_space_member
from apps.community.tests.helpers import create_moderator, scoped_creator
from apps.education.tests.helpers import create_admin, published_path

from ..models import Report
from ..services import create_report

pytestmark = pytest.mark.django_db


def test_public_report_hides_evidence_from_reporter_and_exposes_it_to_moderator() -> None:
    admin = create_admin()
    author = create_user(email="author@example.com", full_name="Discussion Author")
    reporter = create_user(email="reporter@example.com", full_name="Reporting Student")
    moderator = create_moderator()
    _, _, lesson = published_path(admin=admin)
    discussion = create_discussion(
        actor=author,
        context_type="lesson",
        context_id=lesson.id,
        title="Please review the accuracy of this explanation",
        body="This is the immutable evidence body used by the moderation report.",
        client_request_id=uuid4(),
    )
    reporter_client = APIClient()
    reporter_client.force_authenticate(reporter)
    response = reporter_client.post(
        "/api/v1/moderation/reports",
        {
            "target_type": "discussion",
            "target_id": str(discussion.id),
            "reason": "spam",
            "description": "This appears unrelated and duplicated across multiple discussions.",
            "client_request_id": str(uuid4()),
        },
        format="json",
    )
    assert response.status_code == 201
    assert "evidence_snapshot" not in response.json()
    report_id = response.json()["id"]

    moderator_client = APIClient()
    moderator_client.force_authenticate(moderator)
    queue = moderator_client.get("/api/v1/moderation/reports?status=open")
    assert queue.status_code == 200
    assert [item["id"] for item in queue.json()["results"]] == [report_id]
    assert queue.json()["results"][0]["evidence_snapshot"]["body"] == discussion.body


def test_private_space_reports_are_isolated_and_creator_moderation_is_contextual() -> None:
    admin = create_admin()
    author = create_user(email="author@example.com", full_name="Private Space Author")
    reporter = create_user(email="reporter@example.com", full_name="Private Space Reporter")
    _, _, lesson = published_path(admin=admin)
    creator = scoped_creator(admin=admin, node=lesson)
    moderator = create_moderator()
    space = create_space(
        actor=creator,
        context_type="lesson",
        context_id=lesson.id,
        title="Creator-led clinical study room",
        description="A private learning space attached to one lesson.",
    )
    set_space_member(
        actor=creator,
        space_id=space.id,
        user=author,
        role=SpaceMembership.Role.MEMBER,
    )
    set_space_member(
        actor=creator,
        space_id=space.id,
        user=reporter,
        role=SpaceMembership.Role.MEMBER,
    )
    discussion = create_discussion(
        actor=author,
        context_type="lesson",
        context_id=lesson.id,
        space_id=space.id,
        title="Can a creator review this answer inside our study room?",
        body="This private discussion must never enter the global moderator queue.",
        client_request_id=uuid4(),
    )
    reporter_client = APIClient()
    reporter_client.force_authenticate(reporter)
    created = reporter_client.post(
        "/api/v1/moderation/reports",
        {
            "target_type": "discussion",
            "target_id": str(discussion.id),
            "reason": "abuse",
            "description": "This private-space reply needs review by the space moderation team.",
            "client_request_id": str(uuid4()),
        },
        format="json",
    )
    assert created.status_code == 201
    assert created.json()["private_space_id"] == str(space.id)
    report_id = created.json()["id"]

    moderator_client = APIClient()
    moderator_client.force_authenticate(moderator)
    assert moderator_client.get(f"/api/v1/moderation/reports/{report_id}").status_code == 404
    assert moderator_client.get("/api/v1/moderation/reports").json()["results"] == []

    creator_client = APIClient()
    creator_client.force_authenticate(creator)
    detail = creator_client.get(f"/api/v1/moderation/reports/{report_id}")
    assert detail.status_code == 200
    assert detail.json()["evidence_snapshot"]["body"] == discussion.body
    resolved = creator_client.post(
        f"/api/v1/moderation/reports/{report_id}/transition",
        {
            "expected_revision": 1,
            "status": "resolved",
            "resolution_notes": "The private-space discussion was reviewed and removed for abuse.",
            "content_action": "remove",
        },
        format="json",
    )
    assert resolved.status_code == 200
    discussion.refresh_from_db()
    assert discussion.status == Discussion.Status.MODERATOR_REMOVED


def test_report_filters_validate_values_and_students_cannot_use_audit_workspace() -> None:
    student = create_user()
    client = APIClient()
    client.force_authenticate(student)
    assert client.get("/api/v1/moderation/reports?status=unknown").status_code == 400
    assert client.get("/api/v1/moderation/reports?target_type=unknown").status_code == 400
    assert client.get("/api/v1/moderation/audit").status_code == 403


def test_moderation_transition_rejects_stale_revisions_through_the_api() -> None:
    admin = create_admin()
    author = create_user(email="author@example.com", full_name="Discussion Author")
    reporter = create_user(email="reporter@example.com", full_name="Reporting Student")
    moderator = create_moderator()
    _, _, lesson = published_path(admin=admin)
    discussion = create_discussion(
        actor=author,
        context_type="lesson",
        context_id=lesson.id,
        title="This discussion will exercise optimistic concurrency",
        body="Only one moderator transition may win for an expected report revision.",
        client_request_id=uuid4(),
    )
    reporter_client = APIClient()
    reporter_client.force_authenticate(reporter)
    created = reporter_client.post(
        "/api/v1/moderation/reports",
        {
            "target_type": "discussion",
            "target_id": str(discussion.id),
            "reason": "other",
            "description": "The content needs a moderator to verify its learning relevance.",
            "client_request_id": str(uuid4()),
        },
        format="json",
    )
    report_id = created.json()["id"]
    moderator_client = APIClient()
    moderator_client.force_authenticate(moderator)
    first = moderator_client.post(
        f"/api/v1/moderation/reports/{report_id}/transition",
        {"expected_revision": 1, "status": "triaged"},
        format="json",
    )
    assert first.status_code == 200
    stale = moderator_client.post(
        f"/api/v1/moderation/reports/{report_id}/transition",
        {"expected_revision": 1, "status": "in_progress"},
        format="json",
    )
    assert stale.status_code == 409
    assert Report.objects.get(id=report_id).status == Report.Status.TRIAGED


def test_moderation_queue_query_count_does_not_grow_with_reports() -> None:
    admin = create_admin()
    author = create_user(email="author@example.com", full_name="Discussion Author")
    moderator = create_moderator()
    _, _, lesson = published_path(admin=admin)
    discussion = create_discussion(
        actor=author,
        context_type="lesson",
        context_id=lesson.id,
        title="A public discussion used to verify moderation query efficiency",
        body=(
            "Reports on this discussion should serialize without per-report role or scope queries."
        ),
        client_request_id=uuid4(),
    )
    for index in range(10):
        reporter = create_user(
            email=f"reporter{index}@example.com",
            full_name=f"Reporting Student {index}",
        )
        create_report(
            reporter=reporter,
            target_type=Report.TargetType.DISCUSSION,
            target_id=discussion.id,
            reason=Report.Reason.SPAM,
            description=(
                f"Independent spam report number {index} for the moderation queue query test."
            ),
            client_request_id=uuid4(),
        )
    client = APIClient()
    client.force_authenticate(moderator)
    with CaptureQueriesContext(connection) as queries:
        response = client.get("/api/v1/moderation/reports?status=open")
    assert response.status_code == 200
    assert len(response.json()["results"]) == 10
    assert len(queries) <= 9

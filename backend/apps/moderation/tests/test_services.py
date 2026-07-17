from typing import Any
from uuid import uuid4

import pytest

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.community.models import Discussion, DiscussionRevision
from apps.community.services import create_discussion
from apps.community.tests.helpers import create_moderator
from apps.education.tests.helpers import create_admin, published_path
from platform_core.events import DomainEvent, domain_events

from ..events import ModerationReportCreated, ModeratorActionRecorded
from ..models import ModerationAuditEntry, Report
from ..services import (
    ModerationConflictError,
    ModerationRuleError,
    assign_report,
    create_report,
    transition_report,
)

pytestmark = pytest.mark.django_db


def _public_discussion() -> tuple[User, User, Discussion]:
    admin = create_admin()
    author = create_user(email="author@example.com", full_name="Discussion Author")
    reporter = create_user(email="reporter@example.com", full_name="Careful Student")
    _, _, lesson = published_path(admin=admin)
    discussion = create_discussion(
        actor=author,
        context_type="lesson",
        context_id=lesson.id,
        title="Does this explanation use the correct clinical sequence?",
        body="The sequence in this post is intentionally available for a moderation report.",
        client_request_id=uuid4(),
    )
    return reporter, author, discussion


def test_report_creation_is_idempotent_snapshotted_and_evented(
    django_capture_on_commit_callbacks: Any,
) -> None:
    reporter, author, discussion = _public_discussion()
    request_id = uuid4()
    received_created: list[DomainEvent] = []
    received_audit: list[DomainEvent] = []
    unsub_created = domain_events.subscribe(ModerationReportCreated, received_created.append)
    unsub_audit = domain_events.subscribe(ModeratorActionRecorded, received_audit.append)
    try:
        with django_capture_on_commit_callbacks(execute=True):
            report = create_report(
                reporter=reporter,
                target_type=Report.TargetType.DISCUSSION,
                target_id=discussion.id,
                reason=Report.Reason.SPAM,
                description="This appears duplicated and unrelated to the lesson discussion.",
                client_request_id=request_id,
            )
    finally:
        unsub_created()
        unsub_audit()

    assert report.target_author_id == author.id
    assert report.context_type == "lesson"
    assert report.private_space_id is None
    assert report.evidence_snapshot["body"] == discussion.body
    created_events = [
        event for event in received_created if isinstance(event, ModerationReportCreated)
    ]
    audit_events = [event for event in received_audit if isinstance(event, ModeratorActionRecorded)]
    assert [event.report_id for event in created_events] == [report.id]
    assert [event.action for event in audit_events] == ["report_created"]
    assert ModerationAuditEntry.objects.get(report=report).reason == Report.Reason.SPAM

    retried = create_report(
        reporter=reporter,
        target_type=Report.TargetType.DISCUSSION,
        target_id=discussion.id,
        reason=Report.Reason.SPAM,
        description=report.description,
        client_request_id=request_id,
    )
    assert retried.id == report.id
    duplicate = create_report(
        reporter=reporter,
        target_type=Report.TargetType.DISCUSSION,
        target_id=discussion.id,
        reason=Report.Reason.SPAM,
        description=report.description,
        client_request_id=uuid4(),
    )
    assert duplicate.id == report.id


def test_users_cannot_report_their_own_content_or_inaccessible_targets() -> None:
    reporter, author, discussion = _public_discussion()
    with pytest.raises(ModerationRuleError, match="own community content"):
        create_report(
            reporter=author,
            target_type=Report.TargetType.DISCUSSION,
            target_id=discussion.id,
            reason=Report.Reason.OTHER,
            description="I should not be able to report content that I authored myself.",
            client_request_id=uuid4(),
        )
    with pytest.raises(ModerationRuleError, match="not found"):
        create_report(
            reporter=reporter,
            target_type=Report.TargetType.DISCUSSION,
            target_id=uuid4(),
            reason=Report.Reason.OTHER,
            description="An unknown target must not reveal whether private content exists.",
            client_request_id=uuid4(),
        )


def test_moderator_transition_is_server_authoritative_audited_and_conflict_safe(
    django_capture_on_commit_callbacks: Any,
) -> None:
    reporter, _, discussion = _public_discussion()
    moderator = create_moderator()
    report = create_report(
        reporter=reporter,
        target_type=Report.TargetType.DISCUSSION,
        target_id=discussion.id,
        reason=Report.Reason.ABUSE,
        description="This explanation contains abusive language and should be reviewed.",
        client_request_id=uuid4(),
    )
    claimed = assign_report(
        actor=moderator,
        report_id=report.id,
        expected_revision=1,
        assignee=moderator,
    )
    assert claimed.revision == 2
    received: list[DomainEvent] = []
    unsubscribe = domain_events.subscribe(ModeratorActionRecorded, received.append)
    try:
        with django_capture_on_commit_callbacks(execute=True):
            resolved = transition_report(
                actor=moderator,
                report_id=report.id,
                expected_revision=2,
                status=Report.Status.RESOLVED,
                resolution_notes="Confirmed abuse; the discussion was removed after review.",
                content_action="remove",
            )
    finally:
        unsubscribe()
    discussion.refresh_from_db()
    assert resolved.status == Report.Status.RESOLVED
    assert resolved.revision == 3
    assert discussion.status == Discussion.Status.MODERATOR_REMOVED
    assert DiscussionRevision.objects.filter(
        discussion=discussion,
        reason=DiscussionRevision.Reason.MODERATOR_REMOVED,
    ).exists()
    action_events = [event for event in received if isinstance(event, ModeratorActionRecorded)]
    assert {event.action for event in action_events} == {"content_removed", "resolved"}
    with pytest.raises(ModerationConflictError):
        transition_report(
            actor=moderator,
            report_id=report.id,
            expected_revision=2,
            status=Report.Status.REJECTED,
            resolution_notes="This stale transition must never overwrite the resolved state.",
        )


def test_moderators_cannot_review_reports_they_authored_or_that_target_their_content() -> None:
    reporter, _, discussion = _public_discussion()
    moderator = create_moderator()
    own_report = create_report(
        reporter=moderator,
        target_type=Report.TargetType.DISCUSSION,
        target_id=discussion.id,
        reason=Report.Reason.SPAM,
        description="A moderator may report content but may not adjudicate that same report.",
        client_request_id=uuid4(),
    )
    with pytest.raises(ModerationRuleError, match="cannot resolve"):
        transition_report(
            actor=moderator,
            report_id=own_report.id,
            expected_revision=1,
            status=Report.Status.REJECTED,
            resolution_notes="This action is conflicted and must be blocked by the server.",
        )

    moderator_discussion = create_discussion(
        actor=moderator,
        context_type="lesson",
        context_id=discussion.context_id,
        title="A moderator-authored discussion still needs independent review",
        body="Another user should be able to report this, but the author cannot resolve it.",
        client_request_id=uuid4(),
    )
    report = create_report(
        reporter=reporter,
        target_type=Report.TargetType.DISCUSSION,
        target_id=moderator_discussion.id,
        reason=Report.Reason.OTHER,
        description="This report must be assigned to an independent moderator or administrator.",
        client_request_id=uuid4(),
    )
    with pytest.raises(ModerationRuleError, match="cannot resolve"):
        transition_report(
            actor=moderator,
            report_id=report.id,
            expected_revision=1,
            status=Report.Status.REJECTED,
            resolution_notes=(
                "The target author must not decide the report about their own content."
            ),
        )

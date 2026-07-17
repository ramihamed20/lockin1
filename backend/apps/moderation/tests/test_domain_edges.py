from uuid import uuid4

import pytest
from django.contrib import admin as django_admin
from django.test import RequestFactory, override_settings

from apps.accounts.tests.helpers import create_user
from apps.community.admin import (
    CommentRevisionAdmin,
    DiscussionRevisionAdmin,
    SpaceMembershipHistoryAdmin,
)
from apps.community.models import CommentRevision, DiscussionRevision, SpaceMembershipHistory
from apps.community.services import create_comment, create_discussion
from apps.community.tests.helpers import create_moderator, lesson_discussion
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, published_path
from apps.questions.tests.helpers import published_question

from ..admin import ModerationAuditEntryAdmin, ReportAdmin
from ..models import ModerationAuditEntry, Report
from ..services import (
    ModerationConflictError,
    ModerationRateLimitError,
    ModerationRuleError,
    assign_report,
    create_report,
    transition_report,
)

pytestmark = pytest.mark.django_db


def test_evidence_and_history_admin_views_cannot_bypass_domain_services() -> None:
    request = RequestFactory().get("/admin/")
    guarded_admins = (
        ReportAdmin(Report, django_admin.site),
        ModerationAuditEntryAdmin(ModerationAuditEntry, django_admin.site),
        DiscussionRevisionAdmin(DiscussionRevision, django_admin.site),
        CommentRevisionAdmin(CommentRevision, django_admin.site),
        SpaceMembershipHistoryAdmin(SpaceMembershipHistory, django_admin.site),
    )
    for model_admin in guarded_admins:
        assert model_admin.has_add_permission(request) is False
        assert model_admin.has_change_permission(request) is False
        assert model_admin.has_delete_permission(request) is False


def test_reports_snapshot_every_supported_learning_target() -> None:
    admin = create_admin()
    author = create_user(email="author@example.com")
    helper = create_user(email="helper@example.com")
    reporter = create_user(email="reporter@example.com")
    _, _, lesson = published_path(admin=admin)
    discussion = lesson_discussion(author=author, lesson=lesson)
    comment = create_comment(
        actor=helper,
        discussion_id=discussion.id,
        body="This is the reply whose evidence must remain immutable.",
        client_request_id=uuid4(),
    )
    question = published_question(actor=admin, node=lesson)
    learning_object = published_pdf(actor=admin, node=lesson)
    question_version = question.published_version
    learning_object_version = learning_object.published_version
    assert question_version is not None
    assert learning_object_version is not None

    cases = (
        (Report.TargetType.COMMENT, comment.id, Report.Reason.ABUSE),
        (Report.TargetType.QUESTION, question.id, Report.Reason.INCORRECT_QUESTION),
        (Report.TargetType.ANSWER, question.id, Report.Reason.INCORRECT_ANSWER),
        (Report.TargetType.EXPLANATION, question.id, Report.Reason.INCORRECT_EXPLANATION),
        (Report.TargetType.LEARNING_OBJECT, learning_object.id, Report.Reason.OTHER),
    )
    reports = []
    for index, (target_type, target_id, reason) in enumerate(cases):
        reports.append(
            create_report(
                reporter=reporter,
                target_type=target_type,
                target_id=target_id,
                reason=reason,
                description=f"Evidence case {index} needs an independent and careful review.",
                client_request_id=uuid4(),
            )
        )

    comment_report, question_report, answer_report, explanation_report, object_report = reports
    assert comment_report.evidence_snapshot["body"] == comment.body
    assert comment_report.evidence_snapshot["discussion_id"] == str(discussion.id)
    assert question_report.evidence_snapshot["prompt"] == question_version.prompt
    assert "options" not in question_report.evidence_snapshot
    assert len(answer_report.evidence_snapshot["options"]) == 3
    assert explanation_report.evidence_snapshot["explanation"]
    assert object_report.evidence_snapshot["title"] == learning_object_version.title
    assert object_report.evidence_snapshot["content_type"] == "pdf"

    request_id = uuid4()
    first = create_report(
        reporter=reporter,
        target_type=Report.TargetType.DISCUSSION,
        target_id=discussion.id,
        reason=Report.Reason.DUPLICATE,
        description="This separate discussion report reserves an idempotency identifier.",
        client_request_id=request_id,
    )
    assert first.priority == Report.Priority.ROUTINE
    with pytest.raises(ModerationConflictError, match="identifier"):
        create_report(
            reporter=reporter,
            target_type=Report.TargetType.COMMENT,
            target_id=comment.id,
            reason=Report.Reason.SPAM,
            description="Reusing the identifier for a different report must be rejected.",
            client_request_id=request_id,
        )


def test_report_validation_and_rate_limits_fail_closed() -> None:
    admin = create_admin()
    author = create_user(email="author@example.com")
    reporter = create_user(email="reporter@example.com")
    _, _, lesson = published_path(admin=admin)
    discussion = lesson_discussion(author=author, lesson=lesson)

    with pytest.raises(ModerationRuleError, match="Unsupported report reason"):
        create_report(
            reporter=reporter,
            target_type=Report.TargetType.DISCUSSION,
            target_id=discussion.id,
            reason="unsafe",
            description="This description is valid but the reason is not.",
            client_request_id=uuid4(),
        )
    for description in ("short", "valid details\x00with a null character"):
        with pytest.raises(ModerationRuleError, match="Report details"):
            create_report(
                reporter=reporter,
                target_type=Report.TargetType.DISCUSSION,
                target_id=discussion.id,
                reason=Report.Reason.OTHER,
                description=description,
                client_request_id=uuid4(),
            )
    with pytest.raises(ModerationRuleError, match="cannot exceed"):
        create_report(
            reporter=reporter,
            target_type=Report.TargetType.DISCUSSION,
            target_id=discussion.id,
            reason=Report.Reason.OTHER,
            description="x" * 4001,
            client_request_id=uuid4(),
        )
    with pytest.raises(ModerationRuleError, match="Unsupported report target"):
        create_report(
            reporter=reporter,
            target_type="lesson",
            target_id=lesson.id,
            reason=Report.Reason.OTHER,
            description="Unsupported target types must fail without creating a report.",
            client_request_id=uuid4(),
        )

    with override_settings(MODERATION_REPORT_RATE_LIMIT=1):
        create_report(
            reporter=reporter,
            target_type=Report.TargetType.DISCUSSION,
            target_id=discussion.id,
            reason=Report.Reason.SPAM,
            description="The first report consumes the deliberately small test rate bucket.",
            client_request_id=uuid4(),
        )
        with pytest.raises(ModerationRateLimitError):
            create_report(
                reporter=reporter,
                target_type=Report.TargetType.DISCUSSION,
                target_id=discussion.id,
                reason=Report.Reason.ABUSE,
                description=(
                    "A different reason bypasses duplicate detection but not the rate limit."
                ),
                client_request_id=uuid4(),
            )


def test_assignment_and_report_transitions_enforce_fairness_and_audit_history() -> None:
    admin = create_admin()
    author = create_user(email="author@example.com")
    reporter = create_user(email="reporter@example.com")
    student = create_user(email="student@example.com")
    moderator = create_moderator(email="moderator@example.com")
    second_moderator = create_moderator(email="second-moderator@example.com")
    _, _, lesson = published_path(admin=admin)
    discussion = lesson_discussion(author=author, lesson=lesson)
    report = create_report(
        reporter=reporter,
        target_type=Report.TargetType.DISCUSSION,
        target_id=discussion.id,
        reason=Report.Reason.ABUSE,
        description="This report exercises assignment and the complete review state machine.",
        client_request_id=uuid4(),
    )

    with pytest.raises(ModerationRuleError, match="only to a moderator"):
        assign_report(
            actor=admin,
            report_id=report.id,
            expected_revision=1,
            assignee=student,
        )
    with pytest.raises(ModerationRuleError, match="only for themselves"):
        assign_report(
            actor=moderator,
            report_id=report.id,
            expected_revision=1,
            assignee=second_moderator,
        )
    assigned = assign_report(
        actor=admin,
        report_id=report.id,
        expected_revision=1,
        assignee=moderator,
    )
    assert assigned.revision == 2
    with pytest.raises(ModerationConflictError):
        assign_report(
            actor=admin,
            report_id=report.id,
            expected_revision=1,
            assignee=moderator,
        )

    triaged = transition_report(
        actor=moderator,
        report_id=report.id,
        expected_revision=2,
        status=Report.Status.TRIAGED,
        resolution_notes="Evidence was reviewed and the case is ready for investigation.",
    )
    in_progress = transition_report(
        actor=moderator,
        report_id=report.id,
        expected_revision=triaged.revision,
        status=Report.Status.IN_PROGRESS,
        resolution_notes="An independent moderator is now investigating this report.",
    )
    rejected = transition_report(
        actor=moderator,
        report_id=report.id,
        expected_revision=in_progress.revision,
        status=Report.Status.REJECTED,
        resolution_notes="The immutable evidence did not support the reported abuse claim.",
    )
    assert rejected.resolved_at is not None
    assert set(
        ModerationAuditEntry.objects.filter(report=report).values_list("action", flat=True)
    ) >= {"report_created", "assigned", "triaged", "started", "rejected"}
    with pytest.raises(ModerationRuleError, match="already closed"):
        transition_report(
            actor=moderator,
            report_id=report.id,
            expected_revision=rejected.revision,
            status=Report.Status.RESOLVED,
            resolution_notes="Closed reports cannot be rewritten after a final decision.",
        )


def test_duplicate_and_content_action_transitions_validate_their_contract() -> None:
    admin = create_admin()
    author = create_user(email="author@example.com")
    reporter = create_user(email="reporter@example.com")
    moderator = create_moderator()
    _, _, lesson = published_path(admin=admin)
    original_discussion = lesson_discussion(author=author, lesson=lesson)
    duplicate_discussion = create_discussion(
        actor=author,
        context_type="lesson",
        context_id=lesson.id,
        title="Is this second discussion duplicating the first explanation?",
        body="This second body is intentionally distinct while the reported issue may overlap.",
        client_request_id=uuid4(),
    )
    original = create_report(
        reporter=reporter,
        target_type=Report.TargetType.DISCUSSION,
        target_id=original_discussion.id,
        reason=Report.Reason.DUPLICATE,
        description="This is the original report that later duplicate cases can reference.",
        client_request_id=uuid4(),
    )
    duplicate = create_report(
        reporter=reporter,
        target_type=Report.TargetType.DISCUSSION,
        target_id=duplicate_discussion.id,
        reason=Report.Reason.DUPLICATE,
        description="This separate target appears to duplicate the already reported discussion.",
        client_request_id=uuid4(),
    )

    for duplicate_of_id in (None, duplicate.id, uuid4()):
        with pytest.raises(ModerationRuleError):
            transition_report(
                actor=moderator,
                report_id=duplicate.id,
                expected_revision=duplicate.revision,
                status=Report.Status.DUPLICATE,
                resolution_notes="The evidence links this report to an existing original report.",
                duplicate_of_id=duplicate_of_id,
            )
    with pytest.raises(ModerationRuleError, match="Resolution notes"):
        transition_report(
            actor=moderator,
            report_id=duplicate.id,
            expected_revision=duplicate.revision,
            status=Report.Status.RESOLVED,
            resolution_notes="short",
        )
    with pytest.raises(ModerationRuleError, match="Unsupported report transition"):
        transition_report(
            actor=moderator,
            report_id=duplicate.id,
            expected_revision=duplicate.revision,
            status=Report.Status.OPEN,
            resolution_notes="Open is the initial state and cannot be a transition target.",
        )

    marked = transition_report(
        actor=moderator,
        report_id=duplicate.id,
        expected_revision=duplicate.revision,
        status=Report.Status.DUPLICATE,
        resolution_notes="The evidence confirms this is the same issue as the original report.",
        duplicate_of_id=original.id,
    )
    assert marked.duplicate_of_id == original.id

    question = published_question(actor=admin, node=lesson)
    question_report = create_report(
        reporter=reporter,
        target_type=Report.TargetType.QUESTION,
        target_id=question.id,
        reason=Report.Reason.INCORRECT_QUESTION,
        description="This question report must reject community-only content actions.",
        client_request_id=uuid4(),
    )
    with pytest.raises(ModerationRuleError, match="only to community"):
        transition_report(
            actor=moderator,
            report_id=question_report.id,
            expected_revision=question_report.revision,
            status=Report.Status.RESOLVED,
            resolution_notes="The question issue was reviewed without mutating community content.",
            content_action="remove",
        )

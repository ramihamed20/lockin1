from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role
from platform_core.events import publish_after_commit

from .events import ModerationReportCreated, ModeratorActionRecorded
from .models import ModerationAuditEntry, ModerationRateBucket, Report
from .policies import can_manage_report, is_administrator


class ModerationRuleError(ValueError):
    pass


class ModerationConflictError(ValueError):
    pass


class ModerationRateLimitError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class TargetSnapshot:
    target_type: str
    target_id: UUID
    target_version_id: UUID | None
    target_author_id: UUID | None
    label: str
    context_type: str
    context_id: UUID | None
    private_space_id: UUID | None
    evidence: dict[str, Any]


def _window_start(*, now: datetime, seconds: int) -> datetime:
    timestamp = int(now.timestamp())
    return datetime.fromtimestamp(timestamp - (timestamp % seconds), tz=now.tzinfo)


def _consume_report_rate(*, user: User) -> None:
    window_seconds = int(getattr(settings, "MODERATION_REPORT_RATE_WINDOW_SECONDS", 600))
    limit = int(getattr(settings, "MODERATION_REPORT_RATE_LIMIT", 10))
    bucket, created = ModerationRateBucket.objects.get_or_create(
        user=user,
        window_started_at=_window_start(now=timezone.now(), seconds=window_seconds),
        defaults={"count": 1},
    )
    if created:
        return
    updated = ModerationRateBucket.objects.filter(id=bucket.id, count__lt=limit).update(
        count=F("count") + 1
    )
    if updated == 0:
        raise ModerationRateLimitError("Too many reports. Please wait and try again.")


def _resolve_target(*, user: User, target_type: str, target_id: UUID) -> TargetSnapshot:
    if target_type == Report.TargetType.DISCUSSION:
        from apps.community.models import Discussion
        from apps.community.policies import can_view_discussion

        try:
            discussion = Discussion.objects.select_related("space").get(id=target_id)
        except Discussion.DoesNotExist as error:
            raise ModerationRuleError("Report target not found.") from error
        if not can_view_discussion(user=user, discussion=discussion):
            raise ModerationRuleError("Report target not found.")
        return TargetSnapshot(
            target_type,
            discussion.id,
            None,
            discussion.author_id,
            discussion.title,
            discussion.context_type,
            discussion.context_id,
            discussion.space_id,
            {
                "title": discussion.title,
                "body": discussion.body,
                "status": discussion.status,
                "revision": discussion.revision,
                "space_id": str(discussion.space_id) if discussion.space_id else None,
            },
        )
    if target_type == Report.TargetType.COMMENT:
        from apps.community.models import Comment
        from apps.community.policies import can_view_discussion

        try:
            comment = Comment.objects.select_related("discussion", "discussion__space").get(
                id=target_id
            )
        except Comment.DoesNotExist as error:
            raise ModerationRuleError("Report target not found.") from error
        if not can_view_discussion(user=user, discussion=comment.discussion):
            raise ModerationRuleError("Report target not found.")
        return TargetSnapshot(
            target_type,
            comment.id,
            None,
            comment.author_id,
            f"Reply in {comment.discussion.title}",
            comment.discussion.context_type,
            comment.discussion.context_id,
            comment.discussion.space_id,
            {
                "body": comment.body,
                "status": comment.status,
                "revision": comment.revision,
                "discussion_id": str(comment.discussion_id),
                "parent_id": str(comment.parent_id) if comment.parent_id else None,
            },
        )
    if target_type in (
        Report.TargetType.QUESTION,
        Report.TargetType.ANSWER,
        Report.TargetType.EXPLANATION,
    ):
        from apps.questions.models import Question
        from apps.questions.selectors import published_question

        try:
            question = published_question(question_id=target_id)
        except Question.DoesNotExist as error:
            raise ModerationRuleError("Report target not found.") from error
        question_version = question.published_version
        if question_version is None:
            raise ModerationRuleError("Report target not found.")
        evidence: dict[str, Any] = {
            "question_version_id": str(question_version.id),
            "prompt": question_version.prompt,
            "explanation": question_version.explanation,
        }
        if target_type == Report.TargetType.ANSWER:
            evidence["options"] = [
                {"id": str(option.id), "text": option.text, "is_correct": option.is_correct}
                for option in question_version.options.all()
            ]
        return TargetSnapshot(
            target_type,
            question.id,
            question_version.id,
            question.owner_id,
            question_version.prompt,
            "question",
            question.id,
            None,
            evidence,
        )
    if target_type == Report.TargetType.LEARNING_OBJECT:
        from apps.content.models import LearningObject
        from apps.content.selectors import published_learning_object

        try:
            content = published_learning_object(learning_object_id=target_id)
        except LearningObject.DoesNotExist as error:
            raise ModerationRuleError("Report target not found.") from error
        content_version = content.published_version
        if content_version is None:
            raise ModerationRuleError("Report target not found.")
        return TargetSnapshot(
            target_type,
            content.id,
            content_version.id,
            content.owner_id,
            content_version.title,
            "learning_object",
            content.id,
            None,
            {
                "version_id": str(content_version.id),
                "title": content_version.title,
                "summary": content_version.summary,
                "content_type": content_version.content_type,
            },
        )
    raise ModerationRuleError("Unsupported report target.")


def _priority_for(*, reason: str) -> str:
    return Report.Priority.IMPORTANT if reason == Report.Reason.ABUSE else Report.Priority.ROUTINE


def _clean_description(description: str) -> str:
    cleaned = description.strip()
    if len(cleaned) < 10:
        raise ModerationRuleError("Report details must contain at least 10 characters.")
    if len(cleaned) > 4000:
        raise ModerationRuleError("Report details cannot exceed 4000 characters.")
    if "\x00" in cleaned:
        raise ModerationRuleError("Report details contain unsupported characters.")
    return cleaned


def _record_action(
    *,
    actor: User,
    action: str,
    target_type: str,
    target_id: UUID,
    report: Report | None,
    reason: str = "",
    metadata: dict[str, Any] | None = None,
) -> ModerationAuditEntry:
    entry = ModerationAuditEntry.objects.create(
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=target_id,
        report=report,
        reason=reason,
        metadata=metadata or {},
    )
    publish_after_commit(
        ModeratorActionRecorded(
            report_id=report.id if report else None,
            action_id=entry.id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            reporter_id=report.reporter_id if report else None,
            target_author_id=report.target_author_id if report else None,
            actor_id=actor.id,
        )
    )
    return entry


def _create_report_from_snapshot(
    *,
    reporter: User,
    snapshot: TargetSnapshot,
    reason: str,
    description: str,
    client_request_id: UUID,
) -> Report:
    existing = Report.objects.filter(
        reporter=reporter,
        client_request_id=client_request_id,
    ).first()
    if existing is not None:
        same_request = (
            existing.target_type == snapshot.target_type
            and existing.target_id == snapshot.target_id
            and existing.reason == reason
            and existing.description == description
        )
        if not same_request:
            raise ModerationConflictError("That report request identifier is already in use.")
        return existing
    duplicate = Report.objects.filter(
        reporter=reporter,
        target_type=snapshot.target_type,
        target_id=snapshot.target_id,
        reason=reason,
        status__in=(Report.Status.OPEN, Report.Status.TRIAGED, Report.Status.IN_PROGRESS),
    ).first()
    if duplicate is not None:
        return duplicate
    _consume_report_rate(user=reporter)
    report = Report.objects.create(
        reporter=reporter,
        target_type=snapshot.target_type,
        target_id=snapshot.target_id,
        target_version_id=snapshot.target_version_id,
        target_author_id=snapshot.target_author_id,
        target_label=snapshot.label[:220],
        context_type=snapshot.context_type,
        context_id=snapshot.context_id,
        private_space_id=snapshot.private_space_id,
        reason=reason,
        description=description,
        evidence_snapshot=snapshot.evidence,
        priority=_priority_for(reason=reason),
        client_request_id=client_request_id,
    )
    _record_action(
        actor=reporter,
        action=ModerationAuditEntry.Action.REPORT_CREATED,
        target_type=report.target_type,
        target_id=report.target_id,
        report=report,
        reason=reason,
    )
    publish_after_commit(
        ModerationReportCreated(
            report_id=report.id,
            reporter_id=reporter.id,
            target_type=report.target_type,
            target_id=report.target_id,
            reason=reason,
            actor_id=reporter.id,
        )
    )
    return report


@transaction.atomic
def create_report(
    *,
    reporter: User,
    target_type: str,
    target_id: UUID,
    reason: str,
    description: str,
    client_request_id: UUID,
) -> Report:
    if reason not in Report.Reason.values:
        raise ModerationRuleError("Unsupported report reason.")
    cleaned = _clean_description(description)
    snapshot = _resolve_target(user=reporter, target_type=target_type, target_id=target_id)
    if snapshot.target_author_id == reporter.id:
        raise ModerationRuleError("You cannot report your own community content.")
    return _create_report_from_snapshot(
        reporter=reporter,
        snapshot=snapshot,
        reason=reason,
        description=cleaned,
        client_request_id=client_request_id,
    )


@transaction.atomic
def ingest_assessment_report(
    *,
    legacy_report_id: UUID,
    reporter: User,
    question_id: UUID,
    question_version_id: UUID,
    question_owner_id: UUID,
    category: str,
    description: str,
    evidence: dict[str, Any],
) -> Report:
    target_type_by_category = {
        "answer_key": Report.TargetType.ANSWER,
        "explanation": Report.TargetType.EXPLANATION,
        "ambiguous": Report.TargetType.QUESTION,
        "outdated": Report.TargetType.QUESTION,
        "typo": Report.TargetType.QUESTION,
        "other": Report.TargetType.QUESTION,
    }
    reason_by_category = {
        "answer_key": Report.Reason.INCORRECT_ANSWER,
        "explanation": Report.Reason.INCORRECT_EXPLANATION,
        "ambiguous": Report.Reason.INCORRECT_QUESTION,
        "outdated": Report.Reason.INCORRECT_QUESTION,
        "typo": Report.Reason.INCORRECT_QUESTION,
        "other": Report.Reason.OTHER,
    }
    target_type = target_type_by_category.get(category, Report.TargetType.QUESTION)
    reason = reason_by_category.get(category, Report.Reason.OTHER)
    snapshot = TargetSnapshot(
        target_type=target_type,
        target_id=question_id,
        target_version_id=question_version_id,
        target_author_id=question_owner_id,
        label=str(evidence.get("prompt", "Reported assessment question"))[:220],
        context_type="question",
        context_id=question_id,
        private_space_id=None,
        evidence=evidence,
    )
    return _create_report_from_snapshot(
        reporter=reporter,
        snapshot=snapshot,
        reason=reason,
        description=_clean_description(description),
        client_request_id=legacy_report_id,
    )


@transaction.atomic
def assign_report(
    *, actor: User, report_id: UUID, expected_revision: int, assignee: User
) -> Report:
    report = Report.objects.select_for_update().get(id=report_id)
    if not can_manage_report(user=actor, report=report):
        raise ModerationRuleError("You cannot assign this report.")
    if report.revision != expected_revision:
        raise ModerationConflictError("This report changed. Reload it and try again.")
    if not user_has_role(assignee, Role.MODERATOR) and not user_has_role(
        assignee, Role.ADMINISTRATOR
    ):
        raise ModerationRuleError("Reports can be assigned only to a moderator or administrator.")
    if not is_administrator(actor) and assignee.id != actor.id:
        raise ModerationRuleError("Moderators may claim reports only for themselves.")
    if assignee.id in (report.reporter_id, report.target_author_id):
        raise ModerationRuleError("A conflicted moderator cannot be assigned this report.")
    report.assigned_to = assignee
    report.revision += 1
    report.save(update_fields=("assigned_to", "revision", "updated_at"))
    _record_action(
        actor=actor,
        action=ModerationAuditEntry.Action.ASSIGNED,
        target_type=report.target_type,
        target_id=report.target_id,
        report=report,
        metadata={"assignee_id": str(assignee.id)},
    )
    return report


@transaction.atomic
def transition_report(
    *,
    actor: User,
    report_id: UUID,
    expected_revision: int,
    status: str,
    resolution_notes: str,
    duplicate_of_id: UUID | None = None,
    content_action: str | None = None,
) -> Report:
    report = Report.objects.select_for_update().get(id=report_id)
    if not can_manage_report(user=actor, report=report):
        raise ModerationRuleError("You cannot resolve this report.")
    if report.revision != expected_revision:
        raise ModerationConflictError("This report changed. Reload it and try again.")
    if report.status in (Report.Status.RESOLVED, Report.Status.REJECTED, Report.Status.DUPLICATE):
        raise ModerationRuleError("This report is already closed.")
    if status not in Report.Status.values or status == Report.Status.OPEN:
        raise ModerationRuleError("Unsupported report transition.")
    notes = resolution_notes.strip()
    if status in (
        Report.Status.RESOLVED,
        Report.Status.REJECTED,
        Report.Status.DUPLICATE,
    ) and (len(notes) < 10 or len(notes) > 4000):
        raise ModerationRuleError("Resolution notes between 10 and 4000 characters are required.")
    duplicate = None
    if status == Report.Status.DUPLICATE:
        if duplicate_of_id is None or duplicate_of_id == report.id:
            raise ModerationRuleError("Choose the original report for this duplicate.")
        duplicate = Report.objects.filter(id=duplicate_of_id).first()
        if duplicate is None:
            raise ModerationRuleError("Original report not found.")
    if content_action is not None:
        if report.target_type not in (Report.TargetType.DISCUSSION, Report.TargetType.COMMENT):
            raise ModerationRuleError("Content actions apply only to community reports.")
        from apps.community.services import CommunityRuleError, moderate_content

        try:
            moderate_content(
                actor=actor,
                target_type=report.target_type,
                target_id=report.target_id,
                action=content_action,
                reason=notes,
            )
        except CommunityRuleError as error:
            raise ModerationRuleError(str(error)) from error
        action_map = {
            "remove": ModerationAuditEntry.Action.CONTENT_REMOVED,
            "restore": ModerationAuditEntry.Action.CONTENT_RESTORED,
            "lock": ModerationAuditEntry.Action.DISCUSSION_LOCKED,
            "unlock": ModerationAuditEntry.Action.DISCUSSION_UNLOCKED,
        }
        _record_action(
            actor=actor,
            action=action_map[content_action],
            target_type=report.target_type,
            target_id=report.target_id,
            report=report,
            reason=notes,
        )
    report.status = status
    report.resolution_notes = notes
    report.duplicate_of = duplicate
    report.resolved_at = (
        timezone.now()
        if status in (Report.Status.RESOLVED, Report.Status.REJECTED, Report.Status.DUPLICATE)
        else None
    )
    report.revision += 1
    report.save(
        update_fields=(
            "status",
            "resolution_notes",
            "duplicate_of",
            "resolved_at",
            "revision",
            "updated_at",
        )
    )
    action_by_status: dict[str, str] = {
        Report.Status.TRIAGED: ModerationAuditEntry.Action.TRIAGED,
        Report.Status.IN_PROGRESS: ModerationAuditEntry.Action.STARTED,
        Report.Status.RESOLVED: ModerationAuditEntry.Action.RESOLVED,
        Report.Status.REJECTED: ModerationAuditEntry.Action.REJECTED,
        Report.Status.DUPLICATE: ModerationAuditEntry.Action.MARKED_DUPLICATE,
    }
    _record_action(
        actor=actor,
        action=action_by_status[status],
        target_type=report.target_type,
        target_id=report.target_id,
        report=report,
        reason=notes,
        metadata={"duplicate_of_id": str(duplicate.id) if duplicate else None},
    )
    return report

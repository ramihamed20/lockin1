from apps.accounts.events import UserEmailVerified
from apps.achievements.events import AchievementEarned
from apps.achievements.services import record_evidence
from apps.assessments.events import QuizAttemptSubmitted
from apps.community.events import DiscussionCreated, DiscussionReplyCreated
from apps.focus.events import FocusSessionCompleted
from apps.moderation.events import ModeratorActionRecorded
from apps.notifications.models import Notification
from apps.notifications.services import create_notification
from apps.progress.events import LessonCompleted
from apps.rankings.services import record_ranking_fact
from apps.streaks.events import StreakUpdated
from apps.streaks.services import record_activity
from apps.xp.events import XpAwarded
from apps.xp.services import award_xp
from platform_core.events import domain_events

_registered = False


def _lesson_completed(event: LessonCompleted) -> None:
    source = f"lesson:{event.lesson_id}"
    award_xp(
        user_id=event.user_id,
        source_key=source,
        source_event_id=event.event_id,
        source_event_name=event.event_name,
        source_object_id=event.lesson_id,
        rule_code="lesson_completed_v1",
        points=50,
        category="learning",
        reason="Lesson completed",
        occurred_at=event.occurred_at,
        ranking_eligible=True,
    )
    record_activity(
        user_id=event.user_id,
        source_key=source,
        activity_type="lesson.completed",
        source_object_id=event.lesson_id,
        occurred_at=event.occurred_at,
    )
    record_evidence(
        user_id=event.user_id,
        source_key=source,
        evidence_type="lesson.completed",
        source_object_id=event.lesson_id,
        value=1,
        occurred_at=event.occurred_at,
    )


def _focus_completed(event: FocusSessionCompleted) -> None:
    source = f"focus:{event.session_id}"
    if event.active_duration_seconds >= 1_200:
        record_activity(
            user_id=event.user_id,
            source_key=source,
            activity_type="focus.deep_session",
            source_object_id=event.session_id,
            occurred_at=event.occurred_at,
            metadata={"active_duration_seconds": event.active_duration_seconds},
        )
    if event.active_duration_seconds < 1_500:
        return
    bounded_blocks = min(event.active_duration_seconds // 1_500, 4)
    award_xp(
        user_id=event.user_id,
        source_key=source,
        source_event_id=event.event_id,
        source_event_name=event.event_name,
        source_object_id=event.session_id,
        rule_code="deep_focus_v1",
        points=bounded_blocks * 20,
        category="focus",
        reason="Meaningful focus session",
        occurred_at=event.occurred_at,
        ranking_eligible=True,
    )
    record_evidence(
        user_id=event.user_id,
        source_key=source,
        evidence_type="focus.minutes",
        source_object_id=event.session_id,
        value=min(event.active_duration_seconds // 60, 120),
        occurred_at=event.occurred_at,
    )


def _assessment_submitted(event: QuizAttemptSubmitted) -> None:
    if not event.passed or not (event.ranking_eligible or event.achievement_eligible):
        return
    source = f"assessment-result:{event.result_id}"
    points_by_mode = {"practice": 30, "quiz": 60, "mastery": 120}
    award_xp(
        user_id=event.user_id,
        source_key=source,
        source_event_id=event.event_id,
        source_event_name=event.event_name,
        source_object_id=event.result_id,
        rule_code=f"assessment_{event.mode}_passed_v1",
        points=points_by_mode.get(event.mode, 40),
        category="assessment",
        reason=f"{event.mode.title()} passed",
        occurred_at=event.occurred_at,
        ranking_eligible=event.ranking_eligible,
    )
    record_activity(
        user_id=event.user_id,
        source_key=source,
        activity_type="assessment.passed",
        source_object_id=event.result_id,
        occurred_at=event.occurred_at,
        metadata={"mode": event.mode, "percentage": event.percentage},
    )
    if event.achievement_eligible:
        record_evidence(
            user_id=event.user_id,
            source_key=source,
            evidence_type=(
                "assessment.mastery.passed" if event.mode == "mastery" else "assessment.passed"
            ),
            source_object_id=event.result_id,
            value=1,
            occurred_at=event.occurred_at,
            metadata={"mode": event.mode, "percentage": event.percentage},
        )


def _discussion_created(event: DiscussionCreated) -> None:
    record_evidence(
        user_id=event.author_id,
        source_key=f"discussion:{event.discussion_id}",
        evidence_type="community.contextual_discussion",
        source_object_id=event.discussion_id,
        value=1,
        occurred_at=event.occurred_at,
        metadata={"context_type": event.context_type},
    )


def _reply_created(event: DiscussionReplyCreated) -> None:
    recipients = {event.discussion_author_id, event.parent_author_id} - {None, event.author_id}
    for recipient_id in recipients:
        assert recipient_id is not None
        create_notification(
            recipient_id=recipient_id,
            actor_id=event.author_id,
            category=Notification.Category.COMMUNITY,
            template_key="community.reply",
            title="New reply in your discussion",
            body="A learner replied in a study discussion you follow.",
            deduplication_key=f"community-reply:{event.comment_id}",
            target_type="discussion",
            target_id=event.discussion_id,
            target_route=f"/community/discussions/{event.discussion_id}",
            data={"context_type": event.context_type, "context_id": str(event.context_id)},
        )


def _email_verified(event: UserEmailVerified) -> None:
    create_notification(
        recipient_id=event.user_id,
        category=Notification.Category.ACCOUNT,
        template_key="account.email_verified",
        title="Your Lock-in account is ready",
        body="Start with one meaningful study step and build from there.",
        deduplication_key="account:email-verified",
        target_route="/dashboard",
        required=True,
    )


def _achievement_earned(event: AchievementEarned) -> None:
    create_notification(
        recipient_id=event.user_id,
        category=Notification.Category.ACHIEVEMENT,
        template_key="achievement.earned",
        title="Achievement earned",
        body=event.title,
        deduplication_key=f"achievement:{event.earned_id}",
        target_type="achievement",
        target_id=event.earned_id,
        target_route="/progression",
        data={"definition_code": event.definition_code},
    )


def _streak_updated(event: StreakUpdated) -> None:
    record_evidence(
        user_id=event.user_id,
        source_key=f"streak:{event.source_key}",
        evidence_type="streak.current_days",
        source_object_id=None,
        value=max(event.current_days, 1),
        occurred_at=event.occurred_at,
    )


def _xp_awarded(event: XpAwarded) -> None:
    if event.ranking_eligible:
        record_ranking_fact(
            user_id=event.user_id,
            source_transaction_id=event.transaction_id,
            source_key=event.source_key,
            points=event.points,
            category=event.category,
            occurred_at=event.awarded_at,
        )


def _moderator_action(event: ModeratorActionRecorded) -> None:
    recipients = {event.reporter_id, event.target_author_id} - {None, event.actor_id}
    for recipient_id in recipients:
        assert recipient_id is not None
        create_notification(
            recipient_id=recipient_id,
            actor_id=event.actor_id,
            category=Notification.Category.MODERATION,
            template_key="moderation.action",
            title="Moderation update",
            body="A moderation decision was recorded for reported learning content.",
            deduplication_key=f"moderation-action:{event.action_id}",
            data={"action": event.action, "target_type": event.target_type},
        )


def register_subscribers() -> None:
    global _registered
    if _registered:
        return
    domain_events.subscribe(LessonCompleted, _lesson_completed)
    domain_events.subscribe(FocusSessionCompleted, _focus_completed)
    domain_events.subscribe(QuizAttemptSubmitted, _assessment_submitted)
    domain_events.subscribe(DiscussionCreated, _discussion_created)
    domain_events.subscribe(DiscussionReplyCreated, _reply_created)
    domain_events.subscribe(UserEmailVerified, _email_verified)
    domain_events.subscribe(AchievementEarned, _achievement_earned)
    domain_events.subscribe(StreakUpdated, _streak_updated)
    domain_events.subscribe(XpAwarded, _xp_awarded)
    domain_events.subscribe(ModeratorActionRecorded, _moderator_action)
    _registered = True

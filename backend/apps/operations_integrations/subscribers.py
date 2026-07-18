from apps.accounts.events import UserRegistered
from apps.analytics.catalog import Metric
from apps.analytics.services import record_metric
from apps.assessments.events import QuizAttemptSubmitted
from apps.community.events import DiscussionCreated, DiscussionReplyCreated
from apps.focus.events import FocusSessionCompleted
from apps.payments.events import PaymentSucceeded
from apps.progress.events import LessonCompleted
from apps.subscriptions.events import SubscriptionCreated
from platform_core.events import domain_events

_registered = False


def _registered_user(event: UserRegistered) -> None:
    record_metric(
        event_id=event.event_id,
        metric=Metric.REGISTRATIONS,
        occurred_at=event.occurred_at,
        source_event=event.event_name,
        source_object_id=str(event.user_id),
        actor_id=event.user_id,
    )


def _lesson_completed(event: LessonCompleted) -> None:
    record_metric(
        event_id=event.event_id,
        metric=Metric.LESSON_COMPLETIONS,
        occurred_at=event.occurred_at,
        source_event=event.event_name,
        source_object_id=str(event.lesson_id),
        actor_id=event.user_id,
    )


def _focus_completed(event: FocusSessionCompleted) -> None:
    record_metric(
        event_id=event.event_id,
        metric=Metric.FOCUS_SESSIONS,
        occurred_at=event.occurred_at,
        source_event=event.event_name,
        source_object_id=str(event.session_id),
        actor_id=event.user_id,
        dimensions={"context_type": event.context_type},
    )
    record_metric(
        event_id=event.event_id,
        metric=Metric.FOCUS_MINUTES,
        occurred_at=event.occurred_at,
        source_event=event.event_name,
        source_object_id=str(event.session_id),
        actor_id=event.user_id,
        value=event.active_duration_seconds // 60,
        dimensions={"context_type": event.context_type},
    )


def _quiz_submitted(event: QuizAttemptSubmitted) -> None:
    record_metric(
        event_id=event.event_id,
        metric=Metric.QUIZ_SUBMISSIONS,
        occurred_at=event.occurred_at,
        source_event=event.event_name,
        source_object_id=str(event.attempt_id),
        actor_id=event.user_id,
        dimensions={"mode": event.mode},
    )
    if event.mode == "mastery" and event.passed:
        record_metric(
            event_id=event.event_id,
            metric=Metric.MASTERY_PASSES,
            occurred_at=event.occurred_at,
            source_event=event.event_name,
            source_object_id=str(event.attempt_id),
            actor_id=event.user_id,
            dimensions={"mode": event.mode},
        )


def _discussion_created(event: DiscussionCreated) -> None:
    record_metric(
        event_id=event.event_id,
        metric=Metric.COMMUNITY_CONTRIBUTIONS,
        occurred_at=event.occurred_at,
        source_event=event.event_name,
        source_object_id=str(event.discussion_id),
        actor_id=event.author_id,
        dimensions={"kind": "discussion", "context_type": event.context_type},
    )


def _reply_created(event: DiscussionReplyCreated) -> None:
    record_metric(
        event_id=event.event_id,
        metric=Metric.COMMUNITY_CONTRIBUTIONS,
        occurred_at=event.occurred_at,
        source_event=event.event_name,
        source_object_id=str(event.comment_id),
        actor_id=event.author_id,
        dimensions={"kind": "reply", "context_type": event.context_type},
    )


def _subscription_created(event: SubscriptionCreated) -> None:
    record_metric(
        event_id=event.event_id,
        metric=Metric.SUBSCRIPTIONS_STARTED,
        occurred_at=event.occurred_at,
        source_event=event.event_name,
        source_object_id=str(event.subscription_id),
        actor_id=event.user_id,
        dimensions={"status": event.status},
    )


def _payment_succeeded(event: PaymentSucceeded) -> None:
    record_metric(
        event_id=event.event_id,
        metric=Metric.PAYMENT_SUCCEEDED_COUNT,
        occurred_at=event.effective_at,
        source_event=event.event_name,
        source_object_id=str(event.payment_id),
        actor_id=event.user_id,
        dimensions={"currency": event.currency.upper()},
    )
    record_metric(
        event_id=event.event_id,
        metric=Metric.GROSS_REVENUE_MINOR,
        occurred_at=event.effective_at,
        source_event=event.event_name,
        source_object_id=str(event.payment_id),
        actor_id=event.user_id,
        value=event.amount_minor,
        dimensions={"currency": event.currency.upper()},
    )


def register_subscribers() -> None:
    global _registered
    if _registered:
        return
    domain_events.subscribe(UserRegistered, _registered_user)
    domain_events.subscribe(LessonCompleted, _lesson_completed)
    domain_events.subscribe(FocusSessionCompleted, _focus_completed)
    domain_events.subscribe(QuizAttemptSubmitted, _quiz_submitted)
    domain_events.subscribe(DiscussionCreated, _discussion_created)
    domain_events.subscribe(DiscussionReplyCreated, _reply_created)
    domain_events.subscribe(SubscriptionCreated, _subscription_created)
    domain_events.subscribe(PaymentSucceeded, _payment_succeeded)
    _registered = True

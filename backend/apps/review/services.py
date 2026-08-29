from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.education.models import EducationNode

from .contracts import QuestionAttemptEvent
from .models import (
    MistakeEvent,
    ReviewAnswerLog,
    ReviewItem,
    WeeklyRecallQuestion,
    WeeklyRecallSession,
)
from .policy import (
    WEEKLY_RECALL_LIMIT,
    iso_week_key,
    next_review_at,
    select_diverse_weekly_items,
)


class ReviewRuleError(ValueError):
    pass


class ReviewConflictError(ReviewRuleError):
    pass


@dataclass(frozen=True, slots=True)
class AttemptRecord:
    review_item: ReviewItem | None
    mistake_event: MistakeEvent | None
    created: bool


@dataclass(frozen=True, slots=True)
class ReviewAnswerResult:
    answer_log: ReviewAnswerLog
    review_item: ReviewItem
    mistake_event: MistakeEvent | None
    weekly_session: WeeklyRecallSession | None


def subject_for_node(node: EducationNode) -> EducationNode:
    current = node
    while current.kind != EducationNode.Kind.SUBJECT and current.parent_id is not None:
        parent = current.parent
        if parent is None:
            break
        current = parent
    return current


def _answer_texts(options: tuple[dict[str, str], ...], option_ids: tuple[str, ...]) -> list[str]:
    by_id = {str(option.get("id", "")): str(option.get("text", "")) for option in options}
    texts = [by_id[option_id] for option_id in option_ids if option_id in by_id]
    return texts or ["No answer"]


def _validate_attempt(event: QuestionAttemptEvent) -> None:
    if event.source_type not in ReviewItem.SourceType.values:
        raise ReviewRuleError("Unsupported question source type.")
    option_ids = [str(option.get("id", "")) for option in event.options]
    if not event.canonical_key or not event.subject_key or not event.prompt.strip():
        raise ReviewRuleError("Question identity, subject, and prompt are required.")
    if len(option_ids) < 2 or len(option_ids) != len(set(option_ids)) or "" in option_ids:
        raise ReviewRuleError("Question options need unique identifiers.")
    if set(event.selected_option_ids) - set(option_ids):
        raise ReviewRuleError("The selected answer is not part of this question.")
    if not event.correct_option_ids or set(event.correct_option_ids) - set(option_ids):
        raise ReviewRuleError("The correct answer is not part of this question.")


def _record_mistake_locked(*, event: QuestionAttemptEvent) -> tuple[ReviewItem, MistakeEvent, bool]:
    existing_event = (
        MistakeEvent.objects.select_related("review_item")
        .filter(user=event.user, event_key=event.event_key)
        .first()
    )
    if existing_event is not None:
        if existing_event.review_item.canonical_key != event.canonical_key:
            raise ReviewConflictError("That question event identifier is already in use.")
        return existing_event.review_item, existing_event, False

    item = (
        ReviewItem.objects.select_for_update()
        .filter(user=event.user, canonical_key=event.canonical_key)
        .first()
    )
    if item is None:
        item = ReviewItem(
            user=event.user,
            canonical_key=event.canonical_key,
            first_mistake_at=event.answered_at,
            last_mistake_at=event.answered_at,
            next_review_at=event.answered_at,
        )
    elif item.state in (ReviewItem.State.HIDDEN, ReviewItem.State.MASTERED):
        item.relearning_count += 1

    item.question = event.question_version.question if event.question_version is not None else None
    item.last_question_version = event.question_version
    item.subject = event.subject
    item.subject_key = event.subject_key
    item.subject_label_snapshot = event.subject_label.strip() or "Other"
    item.source_type = event.source_type
    item.source_id = event.source_id
    item.source_label_snapshot = event.source_label
    item.source_question_index = event.source_question_index
    item.prompt_snapshot = event.prompt.strip()
    item.explanation_snapshot = event.explanation.strip()
    item.options_snapshot = list(event.options)
    item.correct_option_ids_snapshot = list(event.correct_option_ids)
    item.state = ReviewItem.State.ACTIVE
    item.mastery_level = 0
    item.mistake_count += 1
    item.last_mistake_at = event.answered_at
    item.next_review_at = event.answered_at
    item.full_clean()
    item.save()

    mistake = MistakeEvent.objects.create(
        user=event.user,
        review_item=item,
        event_key=event.event_key,
        source_type=event.source_type,
        source_id=event.source_id,
        source_label_snapshot=event.source_label,
        source_question_index=event.source_question_index,
        prompt_snapshot=event.prompt.strip(),
        selected_answer_snapshot=_answer_texts(event.options, event.selected_option_ids),
        correct_answer_snapshot=_answer_texts(event.options, event.correct_option_ids),
        answered_at=event.answered_at,
    )
    return item, mistake, True


@transaction.atomic
def record_question_attempt(*, event: QuestionAttemptEvent) -> AttemptRecord:
    _validate_attempt(event)
    if event.is_correct:
        return AttemptRecord(review_item=None, mistake_event=None, created=False)
    User.objects.select_for_update().only("id").get(id=event.user.id)
    item, mistake, created = _record_mistake_locked(event=event)
    return AttemptRecord(review_item=item, mistake_event=mistake, created=created)


def _validate_selected_options(item: ReviewItem, selected_option_ids: tuple[str, ...]) -> None:
    available = {str(option.get("id", "")) for option in item.options_snapshot}
    if (
        not selected_option_ids
        or len(selected_option_ids) > 12
        or len(set(selected_option_ids)) != len(selected_option_ids)
        or set(selected_option_ids) - available
    ):
        raise ReviewRuleError("Choose one or more available answers.")


def _complete_weekly_session_if_ready(session: WeeklyRecallSession, answered_at: datetime) -> None:
    questions = WeeklyRecallQuestion.objects.filter(session=session)
    if questions.filter(answered_at__isnull=True).exists():
        return
    session.status = WeeklyRecallSession.Status.COMPLETED
    session.correct_answers = questions.filter(was_correct=True).count()
    session.completed_at = answered_at
    session.save(update_fields=("status", "correct_answers", "completed_at", "updated_at"))


@transaction.atomic
def answer_review_item(
    *,
    user: User,
    review_item_id: UUID,
    selected_option_ids: tuple[str, ...],
    idempotency_key: UUID,
    context: str,
    weekly_question_id: UUID | None = None,
    now: datetime | None = None,
) -> ReviewAnswerResult:
    answered_at = now or timezone.now()
    User.objects.select_for_update().only("id").get(id=user.id)
    existing = (
        ReviewAnswerLog.objects.select_related("review_item", "weekly_question__session")
        .filter(user=user, idempotency_key=idempotency_key)
        .first()
    )
    if existing is not None:
        if existing.review_item_id != review_item_id or existing.context != context:
            raise ReviewConflictError("That review answer identifier is already in use.")
        session = existing.weekly_question.session if existing.weekly_question else None
        return ReviewAnswerResult(existing, existing.review_item, None, session)

    try:
        item = ReviewItem.objects.select_for_update().get(id=review_item_id, user=user)
    except ReviewItem.DoesNotExist as error:
        raise ReviewRuleError("Review question not found.") from error
    _validate_selected_options(item, selected_option_ids)

    weekly_question = None
    weekly_session = None
    if context == ReviewAnswerLog.Context.REVIEW_BANK:
        if item.state != ReviewItem.State.ACTIVE:
            raise ReviewConflictError("This question is no longer in the active Review Bank.")
    elif context == ReviewAnswerLog.Context.WEEKLY_RECALL:
        if weekly_question_id is None:
            raise ReviewRuleError("Weekly Recall question not found.")
        try:
            weekly_question = (
                WeeklyRecallQuestion.objects.select_for_update()
                .select_related("session")
                .get(
                    id=weekly_question_id,
                    review_item=item,
                    session__user=user,
                    session__status=WeeklyRecallSession.Status.ACTIVE,
                )
            )
        except WeeklyRecallQuestion.DoesNotExist as error:
            raise ReviewRuleError("Weekly Recall question not found.") from error
        if weekly_question.answered_at is not None:
            raise ReviewConflictError("This Weekly Recall question is already answered.")
        weekly_session = weekly_question.session
    else:
        raise ReviewRuleError("Unsupported review context.")

    correct_ids = {str(value) for value in item.correct_option_ids_snapshot}
    was_correct = set(selected_option_ids) == correct_ids
    answer_log = ReviewAnswerLog.objects.create(
        user=user,
        review_item=item,
        weekly_question=weekly_question,
        idempotency_key=idempotency_key,
        context=context,
        selected_option_ids=list(selected_option_ids),
        was_correct=was_correct,
        answered_at=answered_at,
    )

    mistake = None
    previous_state = item.state
    item.last_reviewed_at = answered_at
    if was_correct:
        if context == ReviewAnswerLog.Context.REVIEW_BANK:
            item.mastery_level = max(1, item.mastery_level)
        else:
            item.mastery_level = min(4, max(1, item.mastery_level) + 1)
        item.review_correct_count += 1
        item.state = (
            ReviewItem.State.MASTERED if item.mastery_level >= 4 else ReviewItem.State.HIDDEN
        )
        item.next_review_at = next_review_at(
            reviewed_at=answered_at,
            mastery_level=item.mastery_level,
        )
    else:
        item.state = ReviewItem.State.ACTIVE
        item.mastery_level = 0
        item.mistake_count += 1
        item.review_incorrect_count += 1
        if previous_state in (ReviewItem.State.HIDDEN, ReviewItem.State.MASTERED):
            item.relearning_count += 1
        item.last_mistake_at = answered_at
        item.next_review_at = answered_at
        source_type = (
            ReviewItem.SourceType.WEEKLY_RECALL
            if context == ReviewAnswerLog.Context.WEEKLY_RECALL
            else ReviewItem.SourceType.REVIEW
        )
        event = QuestionAttemptEvent(
            user=user,
            event_key=f"review-answer:{idempotency_key}",
            canonical_key=item.canonical_key,
            subject_key=item.subject_key,
            subject_label=item.subject_label_snapshot,
            source_type=source_type,
            source_id=str(weekly_session.id) if weekly_session else str(item.id),
            source_label="Weekly Recall" if weekly_session else "Review Bank",
            source_question_index=(weekly_question.position if weekly_question else None),
            prompt=item.prompt_snapshot,
            explanation=item.explanation_snapshot,
            options=tuple(dict(option) for option in item.options_snapshot),
            selected_option_ids=selected_option_ids,
            correct_option_ids=tuple(str(value) for value in item.correct_option_ids_snapshot),
            is_correct=False,
            answered_at=answered_at,
            question_version=item.last_question_version,
            subject=item.subject,
        )
        mistake = MistakeEvent.objects.create(
            user=user,
            review_item=item,
            event_key=event.event_key,
            source_type=event.source_type,
            source_id=event.source_id,
            source_label_snapshot=event.source_label,
            source_question_index=event.source_question_index,
            prompt_snapshot=event.prompt,
            selected_answer_snapshot=_answer_texts(event.options, event.selected_option_ids),
            correct_answer_snapshot=_answer_texts(event.options, event.correct_option_ids),
            answered_at=answered_at,
        )
    item.full_clean()
    item.save()

    if weekly_question is not None and weekly_session is not None:
        weekly_question.selected_option_ids = list(selected_option_ids)
        weekly_question.was_correct = was_correct
        weekly_question.answered_at = answered_at
        weekly_question.save(update_fields=("selected_option_ids", "was_correct", "answered_at"))
        _complete_weekly_session_if_ready(weekly_session, answered_at)
        weekly_session.refresh_from_db()
    return ReviewAnswerResult(answer_log, item, mistake, weekly_session)


def _weekly_candidates(*, user: User, now: datetime) -> list[ReviewItem]:
    base = list(
        ReviewItem.objects.filter(
            user=user,
            state__in=(ReviewItem.State.HIDDEN, ReviewItem.State.MASTERED),
        ).order_by("next_review_at", "canonical_key")
    )
    usable = [item for item in base if item.options_snapshot and item.correct_option_ids_snapshot]
    due = [item for item in usable if item.next_review_at <= now]
    supplement = [item for item in usable if item.next_review_at > now]
    return [*due, *supplement]


@transaction.atomic
def create_or_resume_weekly_recall(
    *, user: User, now: datetime | None = None
) -> tuple[WeeklyRecallSession, bool]:
    started_at = now or timezone.now()
    User.objects.select_for_update().only("id").get(id=user.id)
    key = iso_week_key(started_at)
    existing = WeeklyRecallSession.objects.filter(user=user, week_key=key).first()
    if existing is not None:
        return existing, False
    selected = select_diverse_weekly_items(
        _weekly_candidates(user=user, now=started_at),
        now=started_at,
        limit=WEEKLY_RECALL_LIMIT,
    )
    if not selected:
        raise ReviewRuleError("No remembered questions are ready for Weekly Recall yet.")
    session = WeeklyRecallSession.objects.create(
        user=user,
        week_key=key,
        total_questions=len(selected),
        started_at=started_at,
    )
    WeeklyRecallQuestion.objects.bulk_create(
        [
            WeeklyRecallQuestion(session=session, review_item=item, position=index)
            for index, item in enumerate(selected, start=1)
        ]
    )
    return session, True

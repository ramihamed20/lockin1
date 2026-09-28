"""The student's own Review data, prepared for answering without a connection.

Review items are the student's past mistakes. Their answer keys were already
revealed when those mistakes were made, and the device needs them to show the
same outcome offline. The answer itself is replayed through the Review
service, which grades it again and owns every state change.
"""

from typing import Any
from uuid import UUID

from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.review.models import ReviewAnswerLog
from apps.review.selectors import (
    all_active_review_items,
    current_weekly_session,
    latest_mistakes,
    review_bank_overview,
    weekly_recall_eligible_count,
)
from apps.review.serializers import (
    mistake_event_payload,
    review_item_payload,
    weekly_session_payload,
)
from apps.review.services import ReviewRuleError, answer_review_item

from .content_versions import payload_version


def review_snapshot(*, user: User) -> dict[str, Any]:
    subjects: dict[str, dict[str, Any]] = {}
    keys: dict[str, dict[str, Any]] = {}
    for item in all_active_review_items(user=user):
        subject = subjects.setdefault(
            item.subject_key,
            {
                "subject_key": item.subject_key,
                "subject_label": item.subject_label_snapshot,
                "count": 0,
                "results": [],
            },
        )
        subject["results"].append(review_item_payload(item))
        subject["count"] += 1
        keys[str(item.id)] = {
            "correct_option_ids": list(item.correct_option_ids_snapshot),
            "explanation": item.explanation_snapshot or None,
        }
    session = current_weekly_session(user=user)
    if session is not None:
        weekly: dict[str, Any] = {"available": True, "session": weekly_session_payload(session)}
        for question in session.questions.all():
            item = question.review_item
            keys[str(item.id)] = {
                "correct_option_ids": list(item.correct_option_ids_snapshot),
                "explanation": item.explanation_snapshot or None,
            }
    else:
        eligible = weekly_recall_eligible_count(user=user)
        weekly = {"available": eligible > 0, "eligible_count": eligible, "session": None}
    mistakes = list(latest_mistakes(user=user, limit=4))
    snapshot = {
        "bank": review_bank_overview(user=user),
        "queue": {
            "count": len(mistakes),
            "results": [mistake_event_payload(item) for item in mistakes],
        },
        "subjects": subjects,
        "weekly": weekly,
        "answer_keys": keys,
    }
    return {**snapshot, "version": payload_version(snapshot)}


def _uuid(value: object, field: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError) as error:
        raise ValidationError({field: ["A valid UUID is required."]}) from error


def replay_review_answer(*, user: User, payload: dict[str, object]) -> dict[str, object]:
    context = payload.get("context")
    if context not in {ReviewAnswerLog.Context.REVIEW_BANK, ReviewAnswerLog.Context.WEEKLY_RECALL}:
        raise ValidationError({"context": ["Unsupported review context."]})
    selected = payload.get("selected_option_ids")
    if not isinstance(selected, list) or not selected or len(selected) > 12:
        raise ValidationError({"selected_option_ids": ["Choose one or more answers."]})
    weekly_question_id = (
        _uuid(payload.get("weekly_question_id"), "weekly_question_id")
        if context == ReviewAnswerLog.Context.WEEKLY_RECALL
        else None
    )
    try:
        result = answer_review_item(
            user=user,
            review_item_id=_uuid(payload.get("review_item_id"), "review_item_id"),
            selected_option_ids=tuple(str(value) for value in selected),
            idempotency_key=_uuid(payload.get("idempotency_key"), "idempotency_key"),
            context=str(context),
            weekly_question_id=weekly_question_id,
        )
    except ReviewRuleError as error:
        raise ValidationError({"review": [str(error)]}) from error
    return {
        "review_item_id": str(result.review_item.id),
        "was_correct": result.answer_log.was_correct,
        "state": result.review_item.state,
        "weekly_session_id": str(result.weekly_session.id) if result.weekly_session else None,
    }

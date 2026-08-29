from typing import Any

from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .models import ReviewItem


class OptionSnapshotSerializer(StrictSerializer):
    id = serializers.CharField(max_length=128, trim_whitespace=True)
    text = serializers.CharField(max_length=2000, trim_whitespace=True)


class QuestionAttemptWriteSerializer(StrictSerializer):
    idempotency_key = serializers.UUIDField()
    question_key = serializers.CharField(max_length=220, trim_whitespace=True)
    subject_key = serializers.CharField(max_length=220, trim_whitespace=True)
    subject_label = serializers.CharField(max_length=220, trim_whitespace=True)
    source_type = serializers.ChoiceField(choices=ReviewItem.SourceType.choices)
    source_id = serializers.CharField(
        max_length=220,
        trim_whitespace=True,
        allow_blank=True,
        required=False,
        default="",
    )
    source_label = serializers.CharField(
        max_length=220,
        trim_whitespace=True,
        allow_blank=True,
        required=False,
        default="",
    )
    source_question_index = serializers.IntegerField(min_value=1, required=False)
    prompt = serializers.CharField(max_length=4000, trim_whitespace=True)
    explanation = serializers.CharField(
        max_length=8000,
        trim_whitespace=True,
        allow_blank=True,
        required=False,
        default="",
    )
    options = serializers.ListField(
        child=OptionSnapshotSerializer(),
        min_length=2,
        max_length=12,
    )
    selected_option_ids = serializers.ListField(
        child=serializers.CharField(max_length=128),
        min_length=1,
        max_length=12,
    )
    correct_option_ids = serializers.ListField(
        child=serializers.CharField(max_length=128),
        min_length=1,
        max_length=12,
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        option_ids = [str(option["id"]) for option in attrs["options"]]
        if len(option_ids) != len(set(option_ids)):
            raise serializers.ValidationError({"options": "Option identifiers must be unique."})
        available = set(option_ids)
        if len(attrs["selected_option_ids"]) != len(set(attrs["selected_option_ids"])):
            raise serializers.ValidationError(
                {"selected_option_ids": "Selected answer identifiers must be unique."}
            )
        if len(attrs["correct_option_ids"]) != len(set(attrs["correct_option_ids"])):
            raise serializers.ValidationError(
                {"correct_option_ids": "Correct answer identifiers must be unique."}
            )
        if set(attrs["selected_option_ids"]) - available:
            raise serializers.ValidationError(
                {"selected_option_ids": "The selected answer is unavailable."}
            )
        if set(attrs["correct_option_ids"]) - available:
            raise serializers.ValidationError(
                {"correct_option_ids": "The correct answer is unavailable."}
            )
        return attrs


class ReviewAnswerWriteSerializer(StrictSerializer):
    idempotency_key = serializers.UUIDField()
    selected_option_ids = serializers.ListField(
        child=serializers.CharField(max_length=128),
        min_length=1,
        max_length=12,
    )


def _original_source(item: ReviewItem) -> dict[str, object]:
    return {
        "type": item.source_type,
        "id": item.source_id or None,
        "label": item.source_label_snapshot or None,
        "question_index": item.source_question_index,
    }


def review_item_payload(item: ReviewItem, *, reveal_answer: bool = False) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": item.id,
        "canonical_key": item.canonical_key,
        "subject_key": item.subject_key,
        "subject_label": item.subject_label_snapshot,
        "prompt": item.prompt_snapshot,
        "explanation_available": bool(item.explanation_snapshot),
        "answer_mode": "multiple" if len(item.correct_option_ids_snapshot) > 1 else "single",
        "options": item.options_snapshot,
        "state": item.state,
        "mastery_level": item.mastery_level,
        "mistake_count": item.mistake_count,
        "review_correct_count": item.review_correct_count,
        "review_incorrect_count": item.review_incorrect_count,
        "last_mistake_at": item.last_mistake_at,
        "next_review_at": item.next_review_at,
        "original_source": _original_source(item),
    }
    if reveal_answer:
        payload["correct_option_ids"] = item.correct_option_ids_snapshot
        payload["explanation"] = item.explanation_snapshot or None
    return payload


def mistake_event_payload(event: Any) -> dict[str, object]:
    item = event.review_item
    return {
        "id": event.id,
        "question_id": item.question_id,
        "review_item_id": item.id,
        "prompt": event.prompt_snapshot,
        "selected_answers": event.selected_answer_snapshot,
        "correct_answers": event.correct_answer_snapshot,
        "subject_key": item.subject_key,
        "subject_label": item.subject_label_snapshot,
        "source_type": event.source_type,
        "source_id": event.source_id or None,
        "source_label": event.source_label_snapshot or None,
        "source_question_index": event.source_question_index,
        "original_source": _original_source(item),
        "answered_at": event.answered_at,
    }


def weekly_session_payload(session: Any) -> dict[str, object]:
    questions = list(session.questions.all())
    return {
        "id": session.id,
        "week_key": session.week_key,
        "status": session.status,
        "total_questions": session.total_questions,
        "correct_answers": session.correct_answers,
        "answered_count": sum(question.answered_at is not None for question in questions),
        "started_at": session.started_at,
        "completed_at": session.completed_at,
        "questions": [
            {
                "id": question.id,
                "position": question.position,
                "selected_option_ids": question.selected_option_ids,
                "was_correct": question.was_correct,
                "answered_at": question.answered_at,
                "review_item": review_item_payload(
                    question.review_item,
                    reveal_answer=question.answered_at is not None,
                ),
            }
            for question in questions
        ],
    }

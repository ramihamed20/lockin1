from rest_framework import serializers

from .models import FeedbackSuggestion


class FeedbackCreateSerializer(serializers.Serializer[dict[str, object]]):
    category = serializers.ChoiceField(
        choices=FeedbackSuggestion.Category.choices,
        default=FeedbackSuggestion.Category.FEATURE,
    )
    message = serializers.CharField(min_length=5, max_length=2000, trim_whitespace=True)


class FeedbackUpdateSerializer(serializers.Serializer[dict[str, object]]):
    status = serializers.ChoiceField(choices=FeedbackSuggestion.Status.choices, required=False)
    admin_note = serializers.CharField(max_length=500, allow_blank=True, required=False)


def own_feedback_payload(item: FeedbackSuggestion) -> dict[str, object]:
    return {
        "id": str(item.id),
        "category": item.category,
        "message": item.message,
        "status": item.status,
        "created_at": item.created_at.isoformat(),
    }


def admin_feedback_payload(item: FeedbackSuggestion) -> dict[str, object]:
    user = item.user
    return {
        **own_feedback_payload(item),
        "admin_note": item.admin_note,
        "user": (
            {"id": str(user.id), "email": user.email, "name": user.full_name} if user else None
        ),
        "updated_at": item.updated_at.isoformat(),
    }

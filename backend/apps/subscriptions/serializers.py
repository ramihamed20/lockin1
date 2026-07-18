from rest_framework import serializers

from .models import Subscription, SubscriptionTransition


class SubscriptionTransitionSerializer(serializers.ModelSerializer[SubscriptionTransition]):
    class Meta:
        model = SubscriptionTransition
        fields = ("id", "from_status", "to_status", "source", "reason_code", "effective_at")


class SubscriptionSerializer(serializers.ModelSerializer[Subscription]):
    product_code = serializers.CharField(source="plan_version.plan.product.code", read_only=True)
    plan_code = serializers.CharField(source="plan_version.plan.code", read_only=True)
    plan_title = serializers.CharField(source="plan_version.title", read_only=True)
    transitions = SubscriptionTransitionSerializer(many=True, read_only=True)

    class Meta:
        model = Subscription
        fields = (
            "id",
            "product_code",
            "plan_code",
            "plan_title",
            "status",
            "trial_started_at",
            "trial_ends_at",
            "current_period_started_at",
            "current_period_ends_at",
            "grace_ends_at",
            "cancel_at_period_end",
            "cancellation_requested_at",
            "ended_at",
            "status_reason",
            "revision",
            "transitions",
        )


class AdminTransitionSerializer(serializers.Serializer[dict[str, object]]):
    to_status = serializers.ChoiceField(choices=Subscription.Status.choices)
    reason_code = serializers.RegexField(r"^[a-z0-9_]{3,80}$")

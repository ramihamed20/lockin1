from datetime import datetime

from django.utils import timezone
from rest_framework import serializers

from apps.entitlements.models import EntitlementGrant
from apps.entitlements.selectors import active_grants_for_user

from .models import Subscription, SubscriptionTransition

DIRECT_STUDY_ENTITLEMENTS = ("focus.workspace", "content.premium", "files.download")


class SubscriptionTransitionSerializer(serializers.ModelSerializer[SubscriptionTransition]):
    class Meta:
        model = SubscriptionTransition
        fields = ("id", "from_status", "to_status", "source", "reason_code", "effective_at")


class SubscriptionSerializer(serializers.ModelSerializer[Subscription]):
    product_code = serializers.CharField(source="plan_version.plan.product.code", read_only=True)
    plan_code = serializers.CharField(source="plan_version.plan.code", read_only=True)
    plan_title = serializers.CharField(source="plan_version.title", read_only=True)
    transitions = SubscriptionTransitionSerializer(many=True, read_only=True)
    access_allowed = serializers.SerializerMethodField()
    expires_at = serializers.SerializerMethodField()
    remaining_days = serializers.SerializerMethodField()

    class Meta:
        model = Subscription
        fields = (
            "id",
            "product_code",
            "plan_code",
            "plan_title",
            "status",
            "payment_verification",
            "trial_started_at",
            "trial_ends_at",
            "current_period_started_at",
            "current_period_ends_at",
            "grace_ends_at",
            "cancel_at_period_end",
            "cancellation_requested_at",
            "ended_at",
            "last_payment_at",
            "status_reason",
            "revision",
            "access_allowed",
            "expires_at",
            "remaining_days",
            "transitions",
        )

    def get_access_allowed(self, subscription: Subscription) -> bool:
        if subscription.status in (
            Subscription.Status.TRIALING,
            Subscription.Status.ACTIVE,
            Subscription.Status.GRACE,
        ):
            return True
        primary_user = subscription.account.primary_user
        if primary_user is None:
            return False
        return (
            active_grants_for_user(user=primary_user)
            .filter(
                source_type=EntitlementGrant.SourceType.MANUAL,
                entitlement__code__in=DIRECT_STUDY_ENTITLEMENTS,
            )
            .exists()
        )

    def get_expires_at(self, subscription: Subscription) -> datetime | None:
        """Return the authoritative deadline for the currently granted access state."""
        if subscription.status == Subscription.Status.TRIALING:
            return subscription.trial_ends_at
        if subscription.status == Subscription.Status.GRACE:
            return subscription.grace_ends_at
        if subscription.status == Subscription.Status.ACTIVE:
            return subscription.current_period_ends_at
        return None

    def get_remaining_days(self, subscription: Subscription) -> int:
        relevant = (
            subscription.grace_ends_at
            if subscription.status == Subscription.Status.GRACE
            else subscription.trial_ends_at
            if subscription.status == Subscription.Status.TRIALING
            else subscription.current_period_ends_at
        )
        if relevant is None:
            return 0
        seconds = max(0.0, (relevant - timezone.now()).total_seconds())
        return int((seconds + 86_399) // 86_400)


class AdminTransitionSerializer(serializers.Serializer[dict[str, object]]):
    to_status = serializers.ChoiceField(choices=Subscription.Status.choices)
    reason_code = serializers.RegexField(r"^[a-z0-9_]{3,80}$")

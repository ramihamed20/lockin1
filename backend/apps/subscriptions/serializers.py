from datetime import datetime, timedelta

from django.utils import timezone
from rest_framework import serializers

from apps.accounts.roles import is_subscription_exempt
from apps.entitlements.models import EntitlementGrant
from apps.entitlements.selectors import active_grants_for_user

from .models import Subscription, SubscriptionTransition

DIRECT_STUDY_ENTITLEMENTS = ("focus.workspace", "content.premium", "files.download")


def founder_access_snapshot() -> dict[str, object]:
    """A stable subscription-shaped response for a Founder without a record."""

    return {
        "id": None,
        "product_code": None,
        "plan_code": None,
        "plan_title": "Founder access",
        "status": "founder",
        "payment_verification": None,
        "trial_started_at": None,
        "trial_ends_at": None,
        "current_period_started_at": None,
        "current_period_ends_at": None,
        "grace_ends_at": None,
        "cancel_at_period_end": False,
        "cancellation_requested_at": None,
        "ended_at": None,
        "last_payment_at": None,
        "status_reason": "founder_access",
        "revision": 0,
        "access_allowed": True,
        "access_exempt": True,
        "expires_at": None,
        "remaining_days": 0,
        "early_renewal_available": False,
        "transitions": [],
    }


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
    access_exempt = serializers.SerializerMethodField()
    expires_at = serializers.SerializerMethodField()
    remaining_days = serializers.SerializerMethodField()
    early_renewal_available = serializers.SerializerMethodField()

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
            "access_exempt",
            "expires_at",
            "remaining_days",
            "early_renewal_available",
            "transitions",
        )

    def get_access_allowed(self, subscription: Subscription) -> bool:
        primary_user = subscription.account.primary_user
        if primary_user is not None and is_subscription_exempt(primary_user):
            return True
        if subscription.status in (
            Subscription.Status.TRIALING,
            Subscription.Status.ACTIVE,
            Subscription.Status.GRACE,
        ):
            return True
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

    def get_access_exempt(self, subscription: Subscription) -> bool:
        primary_user = subscription.account.primary_user
        return primary_user is not None and is_subscription_exempt(primary_user)

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

    def get_early_renewal_available(self, subscription: Subscription) -> bool:
        primary_user = subscription.account.primary_user
        if primary_user is not None and is_subscription_exempt(primary_user):
            return False
        end = subscription.current_period_ends_at
        now = timezone.now()
        return bool(
            subscription.status == Subscription.Status.ACTIVE
            and end is not None
            and end > now
            and end - now <= timedelta(days=7)
        )


class AdminTransitionSerializer(serializers.Serializer[dict[str, object]]):
    to_status = serializers.ChoiceField(choices=Subscription.Status.choices)
    reason_code = serializers.RegexField(r"^[a-z0-9_]{3,80}$")

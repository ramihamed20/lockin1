from typing import Any

from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .models import (
    AdminInternalNote,
    NotificationCampaign,
    PaymentStatusCorrection,
    SubscriptionAdminEvent,
)


class AdminInternalNoteSerializer(serializers.ModelSerializer[AdminInternalNote]):
    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model = AdminInternalNote
        fields = ("id", "target_type", "target_id", "author_id", "author_name", "body", "created_at")
        read_only_fields = fields


class AddNoteSerializer(StrictSerializer):
    body = serializers.CharField(min_length=3, max_length=4000, trim_whitespace=True)
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)


class AdminRefundSerializer(StrictSerializer):
    amount_minor = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(min_length=8, max_length=240, trim_whitespace=True)


class PaymentCorrectionRequestSerializer(StrictSerializer):
    requested_status = serializers.ChoiceField(choices=("succeeded", "failed", "cancelled"))
    provider_reference = serializers.CharField(min_length=3, max_length=180, trim_whitespace=True)
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)


class PaymentCorrectionReviewSerializer(StrictSerializer):
    decision = serializers.ChoiceField(choices=("approve", "reject"))
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)


class PaymentStatusCorrectionSerializer(serializers.ModelSerializer[PaymentStatusCorrection]):
    requested_by_name = serializers.CharField(source="requested_by.full_name", read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by.full_name", read_only=True)

    class Meta:
        model = PaymentStatusCorrection
        fields = (
            "id", "payment_id", "requested_status", "provider_reference", "reason", "status",
            "requested_by_id", "requested_by_name", "reviewed_by_id", "reviewed_by_name",
            "review_reason", "reviewed_at", "created_at",
        )
        read_only_fields = fields


class SubscriptionActionSerializer(StrictSerializer):
    action = serializers.ChoiceField(
        choices=(
            "activate",
            "reactivate",
            "suspend",
            "cancel_now",
            "cancel_period_end",
            "extend",
            "change_expiration",
            "change_plan",
        )
    )
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)
    note = serializers.CharField(max_length=4000, trim_whitespace=True, required=False, allow_blank=True)
    period_ends_at = serializers.DateTimeField(required=False)
    plan_version_id = serializers.UUIDField(required=False)


class EntitlementOverrideSerializer(StrictSerializer):
    entitlement_code = serializers.RegexField(r"^[a-z0-9][a-z0-9._-]{1,78}$")
    starts_at = serializers.DateTimeField(required=False)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        starts_at = attrs.get("starts_at")
        ends_at = attrs.get("ends_at")
        if starts_at is not None and ends_at is not None and ends_at <= starts_at:
            raise serializers.ValidationError({"ends_at": ["The expiration must follow the start."]})
        return attrs


class EntitlementRevokeSerializer(StrictSerializer):
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)


class UserActionSerializer(StrictSerializer):
    action = serializers.ChoiceField(
        choices=(
            "suspend",
            "reactivate",
            "soft_delete",
            "verify_email",
            "unverify_email",
            "logout_all",
            "logout_session",
            "password_reset",
            "replace_product_roles",
        )
    )
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)
    session_id = serializers.UUIDField(required=False)
    roles = serializers.ListField(
        child=serializers.ChoiceField(choices=("student", "creator", "moderator", "administrator")),
        required=False,
        allow_empty=True,
        max_length=3,
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        action = attrs["action"]
        if action == "logout_session" and "session_id" not in attrs:
            raise serializers.ValidationError({"session_id": ["Choose a session to revoke."]})
        if action == "replace_product_roles" and "roles" not in attrs:
            raise serializers.ValidationError({"roles": ["Provide the roles to assign."]})
        if action != "logout_session" and "session_id" in attrs:
            raise serializers.ValidationError({"session_id": ["This action does not accept a session."]})
        return attrs


class OperationalCapabilityUpdateSerializer(StrictSerializer):
    capabilities = serializers.ListField(
        child=serializers.RegexField(r"^[a-z][a-z_]*\.[a-z_]+$"),
        allow_empty=True,
        max_length=40,
    )
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)


class NotificationCampaignSerializer(serializers.ModelSerializer[NotificationCampaign]):
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True)

    class Meta:
        model = NotificationCampaign
        fields = (
            "id",
            "audience",
            "audience_filter",
            "title",
            "body",
            "send_in_app",
            "send_email",
            "status",
            "scheduled_for",
            "created_by_id",
            "created_by_name",
            "reason",
            "delivered_count",
            "failed_count",
            "completed_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class NotificationCampaignCreateSerializer(StrictSerializer):
    audience = serializers.ChoiceField(choices=NotificationCampaign.Audience.choices)
    audience_filter = serializers.JSONField(default=dict)
    title = serializers.CharField(min_length=1, max_length=160, trim_whitespace=True)
    body = serializers.CharField(min_length=1, max_length=320, trim_whitespace=True)
    send_in_app = serializers.BooleanField(default=True)
    send_email = serializers.BooleanField(default=False)
    scheduled_for = serializers.DateTimeField(required=False, allow_null=True)
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)

    def validate_audience_filter(self, value: object) -> dict[str, object]:
        if not isinstance(value, dict):
            raise serializers.ValidationError("Audience filters must be an object.")
        if len(value) > 4:
            raise serializers.ValidationError("Too many audience filters were supplied.")
        return {str(key)[:40]: item for key, item in value.items()}

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        audience = attrs["audience"]
        payload = attrs["audience_filter"]
        if audience == NotificationCampaign.Audience.USER:
            if not isinstance(payload.get("user_id"), str):
                raise serializers.ValidationError({"audience_filter": ["A user_id is required for one-user delivery."]})
        elif audience == NotificationCampaign.Audience.SELECTED_USERS:
            user_ids = payload.get("user_ids")
            if not isinstance(user_ids, list) or not user_ids or len(user_ids) > 250 or not all(isinstance(item, str) for item in user_ids):
                raise serializers.ValidationError({"audience_filter": ["Provide between 1 and 250 user IDs."]})
        elif audience == NotificationCampaign.Audience.PLAN_USERS:
            plan_code = payload.get("plan_code")
            if not isinstance(plan_code, str) or not plan_code.strip():
                raise serializers.ValidationError({"audience_filter": ["A plan_code is required for plan delivery."]})
        elif payload:
            raise serializers.ValidationError({"audience_filter": ["This audience does not accept a filter."]})
        return attrs


class CampaignDispatchSerializer(StrictSerializer):
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)


class PlanPriceInputSerializer(StrictSerializer):
    code = serializers.RegexField(r"^[a-z0-9]+(?:_[a-z0-9]+)*$", max_length=79)
    amount_minor = serializers.IntegerField(min_value=1)
    currency = serializers.RegexField(r"^[A-Za-z]{3}$")
    currency_exponent = serializers.IntegerField(min_value=0, max_value=4, default=2)
    interval = serializers.ChoiceField(choices=("day", "month", "year"))
    interval_count = serializers.IntegerField(min_value=1, max_value=120, default=1)
    region_code = serializers.RegexField(r"^[A-Za-z]{2}$", required=False, allow_blank=True)


class PlanEntitlementInputSerializer(StrictSerializer):
    entitlement_code = serializers.RegexField(r"^[a-z0-9][a-z0-9._-]{1,78}$")
    quantity_limit = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    configuration = serializers.JSONField(default=dict)


class PlanVersionCreateSerializer(StrictSerializer):
    product_id = serializers.UUIDField()
    plan_code = serializers.RegexField(r"^[a-z0-9]+(?:_[a-z0-9]+)*$", max_length=59)
    title = serializers.CharField(min_length=1, max_length=120, trim_whitespace=True)
    description = serializers.CharField(max_length=320, trim_whitespace=True, required=False, allow_blank=True)
    audience = serializers.ChoiceField(choices=("individual", "family", "organization", "institution"), default="individual")
    trial_days = serializers.IntegerField(min_value=0, max_value=365, default=0)
    grace_days = serializers.IntegerField(min_value=0, max_value=365, default=0)
    terms = serializers.JSONField(default=dict)
    prices = PlanPriceInputSerializer(many=True, min_length=1, max_length=20)
    entitlements = PlanEntitlementInputSerializer(many=True, required=False, default=list, max_length=50)
    publish = serializers.BooleanField(default=False)
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)


class PlanActionSerializer(StrictSerializer):
    action = serializers.ChoiceField(choices=("publish", "retire", "restore"))
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)


class SubscriptionAdminEventSerializer(serializers.ModelSerializer[SubscriptionAdminEvent]):
    actor_name = serializers.CharField(source="actor.full_name", read_only=True)

    class Meta:
        model = SubscriptionAdminEvent
        fields = (
            "id",
            "action",
            "actor_id",
            "actor_name",
            "reason",
            "note",
            "previous_state",
            "new_state",
            "created_at",
        )
        read_only_fields = fields

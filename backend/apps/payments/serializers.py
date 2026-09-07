from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .models import ManualRechargeSubmission, Payment


class PaymentSerializer(serializers.ModelSerializer[Payment]):
    manual_submission = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = (
            "id",
            "subscription_id",
            "amount_minor",
            "currency",
            "currency_exponent",
            "refunded_amount_minor",
            "method",
            "status",
            "price_snapshot",
            "failure_code",
            "initiated_at",
            "succeeded_at",
            "failed_at",
            "created_at",
            "manual_submission",
        )

    def get_manual_submission(self, payment: Payment) -> dict[str, object] | None:
        try:
            submission = payment.manual_submission
        except ManualRechargeSubmission.DoesNotExist:
            return None
        return ManualRechargeSubmissionSerializer(submission).data


class ManualRechargeSubmissionSerializer(serializers.ModelSerializer[ManualRechargeSubmission]):
    recharge_codes_masked = serializers.SerializerMethodField()

    class Meta:
        model = ManualRechargeSubmission
        fields = (
            "id",
            "payment_id",
            "status",
            "recharge_codes_masked",
            "submitted_at",
            "reviewed_at",
            "rejection_reason",
            "subscription_period_started_at",
            "subscription_period_ends_at",
        )
        read_only_fields = fields

    def get_recharge_codes_masked(self, submission: ManualRechargeSubmission) -> list[str]:
        codes = list(submission.recharge_codes.all())
        if not codes:
            return [f"•••• {submission.recharge_code_last4}"]
        return [f"•••• {code.last4}" for code in codes]


class ManualRechargeRequestSerializer(StrictSerializer):
    plan_id = serializers.UUIDField()
    recharge_codes = serializers.ListField(
        child=serializers.RegexField(r"^[0-9]{13}$"),
        min_length=1,
        max_length=2,
        write_only=True,
    )


class PaymentIntentSerializer(serializers.Serializer[dict[str, object]]):
    price_id = serializers.UUIDField()

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        unexpected = set(self.initial_data) - {"price_id"}
        if unexpected:
            raise serializers.ValidationError(
                {
                    field: ["This client-owned payment field is not accepted."]
                    for field in unexpected
                }
            )
        return attrs

from rest_framework import serializers

from .models import Refund


class RefundSerializer(serializers.ModelSerializer[Refund]):
    payment_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Refund
        fields = (
            "id",
            "payment_id",
            "amount_minor",
            "currency",
            "currency_exponent",
            "status",
            "reason",
            "failure_code",
            "requested_at",
            "succeeded_at",
            "failed_at",
            "revision",
        )


class RefundRequestSerializer(serializers.Serializer[dict[str, object]]):
    payment_id = serializers.UUIDField()
    amount_minor = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(min_length=3, max_length=240, trim_whitespace=True)

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        allowed = {"payment_id", "amount_minor", "reason"}
        unexpected = set(self.initial_data) - allowed
        if unexpected:
            raise serializers.ValidationError(
                {field: ["This refund field is server-owned."] for field in unexpected}
            )
        return attrs

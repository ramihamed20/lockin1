from rest_framework import serializers

from .models import Payment


class PaymentSerializer(serializers.ModelSerializer[Payment]):
    class Meta:
        model = Payment
        fields = (
            "id",
            "subscription_id",
            "amount_minor",
            "currency",
            "currency_exponent",
            "refunded_amount_minor",
            "status",
            "price_snapshot",
            "failure_code",
            "initiated_at",
            "succeeded_at",
            "failed_at",
            "created_at",
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

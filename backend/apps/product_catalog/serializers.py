from rest_framework import serializers

from .models import Plan, PlanVersion, Price, Product, fixed_period_end


class PriceSerializer(serializers.ModelSerializer[Price]):
    class Meta:
        model = Price
        fields = (
            "id",
            "code",
            "amount_minor",
            "currency",
            "currency_exponent",
            "region_code",
            "interval",
            "interval_count",
            "tax_behavior",
            "valid_until",
            "first_subscription_only",
            "eligibility",
            "installment_amounts_minor",
        )


class PlanVersionSerializer(serializers.ModelSerializer[PlanVersion]):
    prices = PriceSerializer(many=True, read_only=True)
    availability = serializers.SerializerMethodField()
    scope = serializers.SerializerMethodField()
    fixed_period_ends_at = serializers.SerializerMethodField()

    def get_fixed_period_ends_at(self, version: PlanVersion) -> str | None:
        ends_at = fixed_period_end(version)
        return ends_at.isoformat() if ends_at else None

    def get_availability(self, version: PlanVersion) -> str:
        value = version.terms.get("availability", "available")
        return value if value in {"available", "coming_soon"} else "available"

    def get_scope(self, version: PlanVersion) -> dict[str, object]:
        value = version.terms.get("scope", {})
        return value if isinstance(value, dict) else {}

    class Meta:
        model = PlanVersion
        fields = (
            "id",
            "version",
            "title",
            "description",
            "audience",
            "trial_days",
            "grace_days",
            "availability",
            "scope",
            "fixed_period_ends_at",
            "prices",
        )


class PlanSerializer(serializers.ModelSerializer[Plan]):
    current_version = PlanVersionSerializer(read_only=True)

    class Meta:
        model = Plan
        fields = ("id", "code", "current_version")


class ProductSerializer(serializers.ModelSerializer[Product]):
    plans = PlanSerializer(many=True, read_only=True)

    class Meta:
        model = Product
        fields = ("id", "code", "title", "description", "plans")

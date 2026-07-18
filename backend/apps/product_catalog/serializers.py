from rest_framework import serializers

from .models import Plan, PlanVersion, Price, Product


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
        )


class PlanVersionSerializer(serializers.ModelSerializer[PlanVersion]):
    prices = PriceSerializer(many=True, read_only=True)

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

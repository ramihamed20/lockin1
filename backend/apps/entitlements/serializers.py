from rest_framework import serializers

from .models import EntitlementGrant


class EntitlementGrantSerializer(serializers.ModelSerializer[EntitlementGrant]):
    code = serializers.CharField(source="entitlement.code", read_only=True)
    title = serializers.CharField(source="entitlement.title", read_only=True)
    description = serializers.CharField(source="entitlement.description", read_only=True)

    class Meta:
        model = EntitlementGrant
        fields = (
            "id",
            "code",
            "title",
            "description",
            "source_type",
            "starts_at",
            "ends_at",
            "quantity_limit",
            "configuration",
        )


class ManualGrantSerializer(serializers.Serializer[dict[str, object]]):
    user_id = serializers.UUIDField()
    entitlement_code = serializers.RegexField(r"^[a-z][a-z0-9_.-]{2,79}$")
    source_id = serializers.UUIDField()
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    reason_code = serializers.RegexField(r"^[a-z0-9_]{3,80}$")

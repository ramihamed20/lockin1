from typing import Any

from rest_framework import serializers


class OperationalUserSerializer(serializers.Serializer[dict[str, Any]]):
    id = serializers.UUIDField(read_only=True)
    email = serializers.EmailField(read_only=True)
    full_name = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    email_verified = serializers.BooleanField(read_only=True)
    product_roles = serializers.ListField(child=serializers.CharField(), read_only=True)
    operational_roles = serializers.ListField(child=serializers.CharField(), read_only=True)
    date_joined = serializers.DateTimeField(read_only=True)
    cohort = serializers.DictField(read_only=True)


class OperationalRoleUpdateSerializer(serializers.Serializer[dict[str, Any]]):
    roles = serializers.ListField(
        child=serializers.CharField(max_length=40), allow_empty=True, max_length=6
    )
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)

from typing import Any

from rest_framework import serializers


class ConfigurationUpdateSerializer(serializers.Serializer[dict[str, Any]]):
    value = serializers.JSONField()
    expected_version = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(min_length=8, max_length=500, trim_whitespace=True)


class ConfigurationEntrySerializer(serializers.Serializer[dict[str, Any]]):
    key = serializers.CharField(read_only=True)
    name = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    value_type = serializers.CharField(read_only=True)
    value = serializers.JSONField(read_only=True)
    version = serializers.IntegerField(read_only=True)
    minimum = serializers.IntegerField(read_only=True, allow_null=True)
    maximum = serializers.IntegerField(read_only=True, allow_null=True)
    updated_at = serializers.DateTimeField(read_only=True, allow_null=True)

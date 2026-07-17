from collections.abc import Mapping
from typing import Any, cast

from rest_framework import serializers


class StrictSerializer(serializers.Serializer[Any]):
    """Reject unknown input fields so API clients cannot silently send privileged data."""

    def to_internal_value(self, data: Any) -> dict[str, Any]:
        if isinstance(data, Mapping):
            allowed = set(self.fields)
            unknown = sorted(set(data) - allowed)
            if unknown:
                raise serializers.ValidationError(
                    {"non_field_errors": [f"Unknown field: {name}" for name in unknown]}
                )
        return cast(dict[str, Any], super().to_internal_value(data))

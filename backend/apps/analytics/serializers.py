from typing import Any

from rest_framework import serializers

from .catalog import METRICS


class AnalyticsQuerySerializer(serializers.Serializer[dict[str, Any]]):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    metrics = serializers.ListField(
        child=serializers.ChoiceField(choices=tuple(METRICS)), required=False
    )

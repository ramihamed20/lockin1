from rest_framework import serializers

from .models import SearchEntry


class SearchEntrySerializer(serializers.ModelSerializer[SearchEntry]):
    class Meta:
        model = SearchEntry
        fields = (
            "resource_kind",
            "resource_id",
            "content_type",
            "title",
            "summary",
            "language",
            "published_at",
        )
        read_only_fields = fields

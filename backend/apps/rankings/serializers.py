from rest_framework import serializers

from .models import RankingProfile


class RankingProfileSerializer(serializers.ModelSerializer[RankingProfile]):
    class Meta:
        model = RankingProfile
        fields = ("included", "display_mode", "updated_at")
        read_only_fields = ("updated_at",)

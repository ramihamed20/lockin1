from rest_framework import serializers

from .models import RankingProfile


class LiveRankingQuerySerializer(serializers.Serializer[dict[str, str]]):
    period = serializers.ChoiceField(choices=("weekly", "monthly", "all_time"), default="weekly")


class RankingProfileSerializer(serializers.ModelSerializer[RankingProfile]):
    class Meta:
        model = RankingProfile
        fields = ("included", "display_mode", "updated_at")
        read_only_fields = ("updated_at",)

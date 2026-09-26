from typing import Any

from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .schedule_data import PRACTICAL_GROUPS, SUBJECTS, THEORY_GROUPS


class PracticalOverrideSerializer(StrictSerializer):
    schedule_set = serializers.ChoiceField(choices=THEORY_GROUPS)
    practical_group = serializers.ChoiceField(choices=PRACTICAL_GROUPS)


class MyGroupPreferenceWriteSerializer(StrictSerializer):
    theory_group = serializers.ChoiceField(choices=THEORY_GROUPS)
    default_practical_group = serializers.ChoiceField(choices=PRACTICAL_GROUPS)
    practical_overrides = serializers.DictField(
        child=PracticalOverrideSerializer(),
        required=False,
        default=dict,
    )

    def validate_practical_overrides(self, value: dict[str, Any]) -> dict[str, Any]:
        unknown = sorted(set(value) - set(SUBJECTS))
        if unknown:
            raise serializers.ValidationError([f"Unknown subject: {name}" for name in unknown])
        return value

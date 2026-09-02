from typing import cast

from apps.accounts.models import User

from .models import (
    AchievementDefinition,
    AchievementProgress,
    AchievementVersion,
    EarnedAchievement,
)


def achievement_catalog_for_user(*, user: User, language: str) -> list[dict[str, object]]:
    earned_by_definition = {
        earned.definition_id: earned
        for earned in EarnedAchievement.objects.filter(user=user).select_related(
            "definition", "version"
        )
    }
    progress_by_definition = {
        progress.definition_id: progress
        for progress in AchievementProgress.objects.filter(user=user)
    }
    result: list[dict[str, object]] = []
    definitions = AchievementDefinition.objects.filter(
        is_active=True, current_version__isnull=False
    ).select_related("current_version")
    for definition in definitions:
        version = definition.current_version
        version = cast(AchievementVersion, version)
        progress = progress_by_definition.get(definition.id)
        earned = earned_by_definition.get(definition.id)
        result.append(
            {
                "code": definition.code,
                "category": definition.category,
                "icon_key": definition.icon_key,
                "title": version.title_ar if language == "ar" else version.title_en,
                "description": (
                    version.description_ar if language == "ar" else version.description_en
                ),
                "current_value": progress.current_value if progress else 0,
                "target_value": progress.target_value
                if progress
                else int(version.criteria["target"]),
                "earned_at": earned.earned_at if earned else None,
            }
        )
    return result

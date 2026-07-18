from django.contrib import admin

from .models import (
    AchievementDefinition,
    AchievementEvidence,
    AchievementProgress,
    AchievementVersion,
    EarnedAchievement,
)

admin.site.register(
    (
        AchievementDefinition,
        AchievementVersion,
        AchievementEvidence,
        AchievementProgress,
        EarnedAchievement,
    )
)

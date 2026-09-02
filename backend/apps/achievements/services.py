from datetime import datetime
from typing import cast
from uuid import UUID

from django.db import transaction
from django.db.models import Count, Max, Sum
from django.db.models.functions import Coalesce

from apps.accounts.models import User
from platform_core.events import publish_after_commit

from .events import AchievementEarned
from .models import (
    AchievementDefinition,
    AchievementEvidence,
    AchievementProgress,
    AchievementVersion,
    EarnedAchievement,
)


class AchievementRuleError(ValueError):
    pass


def _criterion_value(*, user: User, version: AchievementVersion) -> tuple[int, int]:
    criteria = version.criteria
    evidence_type = str(criteria.get("evidence_type", ""))
    target = int(criteria.get("target", 0))
    aggregation = str(criteria.get("aggregation", "count"))
    if not evidence_type or target <= 0 or aggregation not in {"count", "sum", "max"}:
        raise AchievementRuleError(f"Invalid criteria for {version.definition.code}.")
    evidence = AchievementEvidence.objects.filter(user=user, evidence_type=evidence_type)
    if aggregation == "count":
        value = evidence.aggregate(value=Count("id"))["value"]
    elif aggregation == "sum":
        value = evidence.aggregate(value=Coalesce(Sum("value"), 0))["value"]
    else:
        value = evidence.aggregate(value=Coalesce(Max("value"), 0))["value"]
    return int(value), target


@transaction.atomic
def record_evidence(
    *,
    user_id: UUID,
    source_key: str,
    evidence_type: str,
    source_object_id: UUID | None,
    value: int,
    occurred_at: datetime,
    metadata: dict[str, object] | None = None,
) -> tuple[AchievementEvidence, bool]:
    if value <= 0:
        raise AchievementRuleError("Achievement evidence must have a positive value.")
    user = User.objects.get(id=user_id, is_active=True)
    evidence, created = AchievementEvidence.objects.get_or_create(
        user=user,
        source_key=source_key,
        defaults={
            "evidence_type": evidence_type,
            "source_object_id": source_object_id,
            "value": value,
            "occurred_at": occurred_at,
            "metadata": metadata or {},
        },
    )
    if not created:
        return evidence, False

    definitions = AchievementDefinition.objects.filter(
        is_active=True,
        current_version__criteria__evidence_type=evidence_type,
    ).select_related("current_version")
    for definition in definitions:
        version = definition.current_version
        if version is None:
            continue
        current, target = _criterion_value(user=user, version=version)
        progress, _ = AchievementProgress.objects.select_for_update().get_or_create(
            user=user,
            definition=definition,
            defaults={"version": version, "target_value": target},
        )
        progress.version = version
        progress.current_value = current
        progress.target_value = target
        progress.revision += 1
        progress.save()
        if current < target:
            continue
        earned, was_awarded = EarnedAchievement.objects.get_or_create(
            user=user,
            definition=definition,
            defaults={
                "version": version,
                "evidence_snapshot": {
                    "evidence_type": evidence_type,
                    "value": current,
                    "target": target,
                    "source_key": source_key,
                },
                "earned_at": occurred_at,
            },
        )
        if was_awarded:
            publish_after_commit(
                AchievementEarned(
                    earned_id=earned.id,
                    user_id=user.id,
                    definition_code=definition.code,
                    title=version.title_en,
                    earned_at=earned.earned_at,
                )
            )
    return evidence, True


def rebuild_progress(*, user: User) -> None:
    for definition in AchievementDefinition.objects.filter(
        is_active=True, current_version__isnull=False
    ).select_related("current_version"):
        version = definition.current_version
        version = cast(AchievementVersion, version)
        current, target = _criterion_value(user=user, version=version)
        AchievementProgress.objects.update_or_create(
            user=user,
            definition=definition,
            defaults={
                "version": version,
                "current_value": current,
                "target_value": target,
            },
        )

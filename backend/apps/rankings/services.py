import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from apps.accounts.models import User
from platform_core.events import publish_after_commit

from .events import RankingSnapshotPublished
from .models import (
    RankingDefinition,
    RankingEntry,
    RankingFact,
    RankingProfile,
    RankingSnapshot,
)


def record_ranking_fact(
    *,
    user_id: UUID,
    source_transaction_id: UUID,
    source_key: str,
    points: int,
    category: str,
    occurred_at: datetime,
) -> tuple[RankingFact, bool]:
    return RankingFact.objects.get_or_create(
        source_transaction_id=source_transaction_id,
        defaults={
            "user_id": user_id,
            "source_key": source_key,
            "points": points,
            "category": category,
            "occurred_at": occurred_at,
        },
    )


def _period_bounds(
    definition: RankingDefinition, now: datetime
) -> tuple[datetime | None, datetime | None]:
    if definition.period == RankingDefinition.Period.ALL_TIME:
        return None, None
    start = datetime(now.year, now.month, 1, tzinfo=UTC)
    if now.month == 12:
        end = datetime(now.year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(now.year, now.month + 1, 1, tzinfo=UTC)
    return start, end


def build_snapshot(*, definition: RankingDefinition) -> RankingSnapshot:
    now = timezone.now()
    period_start, period_end = _period_bounds(definition, now)
    rules_snapshot = {
        "metric": definition.metric,
        "period": definition.period,
        "tie_strategy": definition.tie_strategy,
        "scope": definition.scope,
        "definition_revision": definition.revision,
        **definition.rules,
    }
    snapshot = RankingSnapshot.objects.create(
        definition=definition,
        definition_revision=definition.revision,
        period_start=period_start,
        period_end=period_end,
        status=RankingSnapshot.Status.BUILDING,
        rules_snapshot=rules_snapshot,
    )
    try:
        return _populate_snapshot(
            snapshot=snapshot,
            definition=definition,
            now=now,
            period_start=period_start,
            period_end=period_end,
        )
    except Exception as error:
        RankingSnapshot.objects.filter(id=snapshot.id).update(
            status=RankingSnapshot.Status.FAILED,
            error=f"{type(error).__name__}: {error}"[:1_000],
        )
        raise


@transaction.atomic
def _populate_snapshot(
    *,
    snapshot: RankingSnapshot,
    definition: RankingDefinition,
    now: datetime,
    period_start: datetime | None,
    period_end: datetime | None,
) -> RankingSnapshot:
    definition = RankingDefinition.objects.select_for_update().get(
        id=definition.id,
        revision=snapshot.definition_revision,
        is_active=True,
    )
    snapshot = RankingSnapshot.objects.select_for_update().get(id=snapshot.id)
    facts = RankingFact.objects.filter(is_valid=True, user__is_active=True, user__status="active")
    if period_start is not None:
        facts = facts.filter(occurred_at__gte=period_start, occurred_at__lt=period_end)
    facts = facts.filter(
        Q(user__ranking_profile__included=True) | Q(user__ranking_profile__isnull=True)
    )
    scores = list(
        facts.values("user_id")
        .annotate(score=Sum("points"), evidence_count=Count("id"))
        .filter(score__gt=0)
        .order_by("-score", "user_id")
    )
    entries: list[RankingEntry] = []
    previous_score: int | None = None
    position = 0
    dense_position = 0
    for ordinal, row in enumerate(scores, start=1):
        score = int(row["score"])
        if score != previous_score:
            dense_position += 1
            position = (
                ordinal
                if definition.tie_strategy == RankingDefinition.TieStrategy.COMPETITION
                else dense_position
            )
            previous_score = score
        entries.append(
            RankingEntry(
                snapshot=snapshot,
                user_id=row["user_id"],
                position=position,
                score=score,
                evidence_count=int(row["evidence_count"]),
            )
        )
    RankingEntry.objects.bulk_create(entries, batch_size=1_000)
    checksum_payload = [
        (str(entry.user_id), entry.position, entry.score, entry.evidence_count) for entry in entries
    ]
    snapshot.status = RankingSnapshot.Status.PUBLISHED
    snapshot.participant_count = len(entries)
    snapshot.source_fact_count = sum(entry.evidence_count for entry in entries)
    snapshot.checksum = hashlib.sha256(
        json.dumps(checksum_payload, separators=(",", ":")).encode()
    ).hexdigest()
    snapshot.generated_at = now
    snapshot.save()
    publish_after_commit(
        RankingSnapshotPublished(
            snapshot_id=snapshot.id,
            definition_code=definition.code,
            participant_count=len(entries),
            published_at=now,
        )
    )
    return snapshot


def get_or_create_profile(*, user: User) -> RankingProfile:
    profile, _ = RankingProfile.objects.get_or_create(user=user)
    return profile

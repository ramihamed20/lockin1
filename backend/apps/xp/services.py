from datetime import datetime
from uuid import UUID

from django.db import transaction
from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import Coalesce

from apps.accounts.models import User
from platform_core.events import publish_after_commit

from .events import XpAwarded
from .models import XpBalance, XpTransaction


class XpRuleError(ValueError):
    pass


@transaction.atomic
def award_xp(
    *,
    user_id: UUID,
    source_key: str,
    source_event_id: UUID | None,
    source_event_name: str,
    source_object_id: UUID | None,
    rule_code: str,
    points: int,
    category: str,
    reason: str,
    occurred_at: datetime,
    ranking_eligible: bool,
) -> tuple[XpTransaction, bool]:
    if points <= 0 or points > 2_000:
        raise XpRuleError("A normal XP award must be between 1 and 2,000 points.")
    user = User.objects.get(id=user_id, is_active=True)
    award, created = XpTransaction.objects.get_or_create(
        user=user,
        source_key=source_key,
        rule_code=rule_code,
        defaults={
            "source_event_id": source_event_id,
            "source_event_name": source_event_name,
            "source_object_id": source_object_id,
            "points": points,
            "category": category,
            "reason": reason,
            "ranking_eligible": ranking_eligible,
            "occurred_at": occurred_at,
        },
    )
    if not created:
        return award, False

    balance, _ = XpBalance.objects.select_for_update().get_or_create(user=user)
    balance.total_points += points
    if ranking_eligible:
        balance.ranking_points += points
    balance.transaction_count += 1
    balance.revision += 1
    balance.last_awarded_at = max(filter(None, (balance.last_awarded_at, occurred_at)))
    balance.save(
        update_fields=(
            "total_points",
            "ranking_points",
            "transaction_count",
            "revision",
            "last_awarded_at",
            "updated_at",
        )
    )
    publish_after_commit(
        XpAwarded(
            transaction_id=award.id,
            user_id=user.id,
            points=award.points,
            category=award.category,
            ranking_eligible=award.ranking_eligible,
            source_key=award.source_key,
            awarded_at=award.occurred_at,
            causation_id=source_event_id,
        )
    )
    return award, True


@transaction.atomic
def rebuild_balance(*, user: User) -> XpBalance:
    totals = XpTransaction.objects.filter(user=user).aggregate(
        total=Coalesce(Sum("points"), 0),
        ranking=Coalesce(Sum("points", filter=Q(ranking_eligible=True)), 0),
        count=Count("id"),
        last=Max("occurred_at"),
    )
    balance, _ = XpBalance.objects.select_for_update().get_or_create(user=user)
    balance.total_points = max(int(totals["total"]), 0)
    balance.ranking_points = max(int(totals["ranking"]), 0)
    balance.transaction_count = int(totals["count"])
    balance.last_awarded_at = totals["last"]
    balance.revision += 1
    balance.save()
    return balance

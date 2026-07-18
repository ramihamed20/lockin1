from django.db.models import QuerySet

from apps.accounts.models import User

from .models import XpBalance, XpTransaction


def xp_ledger_for_user(*, user: User) -> QuerySet[XpTransaction]:
    return XpTransaction.objects.filter(user=user).order_by("-occurred_at", "-id")


def xp_summary_for_user(*, user: User) -> dict[str, object]:
    balance = XpBalance.objects.filter(user=user).first()
    total = balance.total_points if balance else 0
    level = 1 + total // 500
    within_level = total % 500
    return {
        "total_points": total,
        "ranking_points": balance.ranking_points if balance else 0,
        "transaction_count": balance.transaction_count if balance else 0,
        "level": level,
        "level_progress": within_level,
        "level_target": 500,
        "last_awarded_at": balance.last_awarded_at if balance else None,
    }

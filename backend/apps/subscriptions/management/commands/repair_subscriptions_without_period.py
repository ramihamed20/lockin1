import json
from typing import Any

from django.core.management import BaseCommand
from django.db import transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.subscriptions.models import Subscription, SubscriptionTransition
from apps.subscriptions.services import transition_subscription


def invalid_active_subscriptions() -> QuerySet[Subscription]:
    now = timezone.now()
    return (
        Subscription.objects.filter(status=Subscription.Status.ACTIVE)
        .exclude(Q(current_period_ends_at__gt=now))
        .exclude(Q(grace_ends_at__gt=now))
    )


class Command(BaseCommand):
    help = (
        "Report ACTIVE subscriptions with no effective period; --apply safely "
        "expires them so the normal renewal path is available."
    )

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args: Any, **options: Any) -> None:
        del args
        if options["apply"] and options["dry_run"]:
            raise ValueError("Choose either --apply or --dry-run, not both.")
        rows = list(
            invalid_active_subscriptions()
            .select_related("account__primary_user")
            .order_by("created_at", "id")
        )
        report = [
            {
                "subscription_id": str(item.id),
                "user_id": str(item.account.primary_user_id or ""),
                "email": item.account.primary_user.email if item.account.primary_user else "",
                "current_period_ends_at": (
                    item.current_period_ends_at.isoformat() if item.current_period_ends_at else None
                ),
                "grace_ends_at": item.grace_ends_at.isoformat() if item.grace_ends_at else None,
            }
            for item in rows
        ]
        repaired = 0
        if options["apply"]:
            with transaction.atomic():
                for item in rows:
                    transition_subscription(
                        subscription_id=item.id,
                        to_status=Subscription.Status.EXPIRED,
                        reason_code="active_period_invalid_repair",
                        source=SubscriptionTransition.Source.RECONCILIATION,
                        effective_at=timezone.now(),
                        idempotency_key=f"active-period-invalid-repair:{item.id}",
                        allow_out_of_order=True,
                    )
                    repaired += 1
        self.stdout.write(
            json.dumps(
                {
                    "mode": "apply" if options["apply"] else "dry-run",
                    "affected": len(report),
                    "repaired": repaired,
                    "subscriptions": report,
                },
                sort_keys=True,
            )
        )

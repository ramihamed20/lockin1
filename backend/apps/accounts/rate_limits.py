"""Reserve database-backed attempt budgets before sensitive work starts."""

import hashlib
from dataclasses import dataclass
from datetime import timedelta

from django.db import connection, transaction
from django.utils import timezone

from .models import AuthAttempt


@dataclass(frozen=True)
class AttemptBudget:
    scope: str
    key_hash: str
    window_seconds: int
    limit: int


@transaction.atomic
def reserve_attempts(budgets: list[AttemptBudget]) -> list[int] | None:
    # Empty buckets have no row to lock. PostgreSQL transaction advisory locks
    # serialize their first request too, across processes and connections.
    # Stable ordering avoids cycles when requests share several budgets.
    if connection.vendor == "postgresql":
        keys = sorted(
            {
                int.from_bytes(
                    hashlib.sha256(f"lockin.auth-budget:{b.scope}:{b.key_hash}".encode()).digest()[
                        :8
                    ],
                    "big",
                    signed=True,
                )
                for b in budgets
            }
        )
        with connection.cursor() as cursor:
            for key in keys:
                cursor.execute("SELECT pg_advisory_xact_lock(%s)", [key])
    now = timezone.now()
    for budget in budgets:
        if (
            AuthAttempt.objects.filter(
                scope=budget.scope,
                key_hash=budget.key_hash,
                attempted_at__gte=now - timedelta(seconds=budget.window_seconds),
            ).count()
            >= budget.limit
        ):
            return None
    return [
        AuthAttempt.objects.create(
            scope=budget.scope,
            key_hash=budget.key_hash,
            attempted_at=now,
        ).pk
        for budget in budgets
    ]

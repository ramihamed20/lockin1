from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from django.db import models, transaction
from django.utils import timezone

from .models import ScheduledJobState


@dataclass(frozen=True)
class JobClaim:
    code: str
    token: UUID
    started_at: datetime


@transaction.atomic
def claim_scheduled_job(
    *,
    code: str,
    interval_seconds: int,
    lease_seconds: int,
) -> JobClaim | None:
    now = timezone.now()
    ScheduledJobState.objects.get_or_create(code=code, defaults={"next_run_at": now})
    state = ScheduledJobState.objects.select_for_update().get(code=code)
    lease_is_live = (
        state.status == ScheduledJobState.Status.RUNNING
        and state.last_started_at is not None
        and state.last_started_at > now - timedelta(seconds=max(60, lease_seconds))
    )
    if state.next_run_at > now or lease_is_live:
        return None

    token = ScheduledJobState.new_claim_token()
    state.status = ScheduledJobState.Status.RUNNING
    state.claim_token = token
    state.last_started_at = now
    state.next_run_at = now + timedelta(seconds=max(60, interval_seconds))
    state.last_error_code = ""
    state.save(
        update_fields=(
            "status",
            "claim_token",
            "last_started_at",
            "next_run_at",
            "last_error_code",
            "updated_at",
        )
    )
    return JobClaim(code=code, token=token, started_at=now)


def finish_scheduled_job(
    *,
    claim: JobClaim,
    succeeded: bool,
    duration_ms: int,
    error_code: str = "",
) -> bool:
    now = timezone.now()
    updates = {
        "status": (
            ScheduledJobState.Status.SUCCEEDED if succeeded else ScheduledJobState.Status.FAILED
        ),
        "claim_token": None,
        "last_duration_ms": max(0, duration_ms),
        "last_error_code": "" if succeeded else error_code[:120],
        "updated_at": now,
    }
    if succeeded:
        updates["last_succeeded_at"] = now
    else:
        updates["last_failed_at"] = now
    updated = ScheduledJobState.objects.filter(
        code=claim.code,
        claim_token=claim.token,
        status=ScheduledJobState.Status.RUNNING,
    ).update(**updates)
    if updated:
        counter = "run_count" if succeeded else "failure_count"
        ScheduledJobState.objects.filter(code=claim.code).update(**{counter: models.F(counter) + 1})
    return bool(updated)

from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from platform_core.events import publish_after_commit

from .events import StreakUpdated
from .models import StreakActivity, StreakPolicy, UserStreak


class StreakRuleError(ValueError):
    pass


def active_policy() -> StreakPolicy:
    policy = StreakPolicy.objects.filter(code="learning_days", is_active=True).first()
    if policy is None:
        policy = StreakPolicy.objects.create(
            code="learning_days",
            version=1,
            title="Meaningful learning days",
            qualifying_activity_types=[
                "lesson.completed",
                "assessment.passed",
                "focus.deep_session",
            ],
            boundary_timezone="UTC",
            rules={"minimum_focus_seconds": 1200},
            is_active=True,
        )
    return policy


def _qualified_date(*, occurred_at: datetime, policy: StreakPolicy) -> date:
    try:
        zone = ZoneInfo(policy.boundary_timezone)
    except ZoneInfoNotFoundError as error:
        raise StreakRuleError("The active streak policy has an invalid timezone.") from error
    return occurred_at.astimezone(zone).date()


def _calculate(days: list[date], *, today: date) -> tuple[int, int, date | None]:
    unique_days = sorted(set(days))
    if not unique_days:
        return 0, 0, None
    longest = run = 1
    for previous, current in zip(unique_days, unique_days[1:], strict=False):
        run = run + 1 if current == previous + timedelta(days=1) else 1
        longest = max(longest, run)

    last = unique_days[-1]
    current_run = 1
    for index in range(len(unique_days) - 1, 0, -1):
        if unique_days[index] != unique_days[index - 1] + timedelta(days=1):
            break
        current_run += 1
    if last < today - timedelta(days=1):
        current_run = 0
    return current_run, longest, last


@transaction.atomic
def record_activity(
    *,
    user_id: UUID,
    source_key: str,
    activity_type: str,
    source_object_id: UUID | None,
    occurred_at: datetime,
    metadata: dict[str, object] | None = None,
) -> tuple[UserStreak, bool]:
    policy = active_policy()
    if activity_type not in policy.qualifying_activity_types:
        raise StreakRuleError("This activity does not qualify under the active streak policy.")
    user = User.objects.get(id=user_id, is_active=True)
    qualified_on = _qualified_date(occurred_at=occurred_at, policy=policy)
    activity, created = StreakActivity.objects.get_or_create(
        user=user,
        source_key=source_key,
        defaults={
            "policy": policy,
            "activity_type": activity_type,
            "source_object_id": source_object_id,
            "qualified_on": qualified_on,
            "occurred_at": occurred_at,
            "metadata": metadata or {},
        },
    )
    state, _ = UserStreak.objects.select_for_update().get_or_create(
        user=user, defaults={"policy": policy}
    )
    if not created:
        return state, False
    days = list(
        StreakActivity.objects.filter(user=user, policy=policy).values_list(
            "qualified_on", flat=True
        )
    )
    today = _qualified_date(occurred_at=timezone.now(), policy=policy)
    current, longest, last = _calculate(days, today=today)
    state.policy = policy
    state.current_days = current
    state.longest_days = longest
    state.last_qualified_on = last
    state.revision += 1
    state.save()
    assert last is not None
    publish_after_commit(
        StreakUpdated(
            user_id=user.id,
            current_days=current,
            longest_days=longest,
            last_qualified_on=last,
            source_key=activity.source_key,
        )
    )
    return state, True


@transaction.atomic
def rebuild_streak(*, user: User) -> UserStreak:
    policy = active_policy()
    days = list(
        StreakActivity.objects.filter(user=user, policy=policy).values_list(
            "qualified_on", flat=True
        )
    )
    today = _qualified_date(occurred_at=timezone.now(), policy=policy)
    current, longest, last = _calculate(days, today=today)
    state, _ = UserStreak.objects.select_for_update().get_or_create(
        user=user, defaults={"policy": policy}
    )
    state.policy = policy
    state.current_days = current
    state.longest_days = longest
    state.last_qualified_on = last
    state.revision += 1
    state.save()
    return state

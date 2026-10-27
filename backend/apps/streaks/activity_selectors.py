"""Small account-owned activity read models for study scheduling."""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db.models.functions import TruncDate

from apps.accounts.models import User

from .models import StreakActivity


def recent_study_days(*, user: User, now: datetime, zone_name: str) -> list[str]:
    """Seven local dates with qualifying study evidence, including today."""
    zone = ZoneInfo(zone_name)
    today = now.astimezone(zone).date()
    start = datetime.combine(today - timedelta(days=6), time.min, tzinfo=zone)
    dates = (
        StreakActivity.objects.filter(user=user, occurred_at__gte=start, occurred_at__lte=now)
        .order_by()
        .annotate(local_day=TruncDate("occurred_at", tzinfo=zone))
        .values_list("local_day", flat=True)
        .distinct()
    )
    return sorted(day.isoformat() for day in dates)

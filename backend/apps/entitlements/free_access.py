from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.utils import timezone

TRIPOLI = dt_timezone(timedelta(hours=2))

# Preserve the historical Human Medicine promotion and its existing tests.
FREE_ACCESS_PROGRAM_CODES = frozenset({"human-medicine"})
FREE_ACCESS_ENDS_AT = datetime(2026, 10, 23, 23, 59, 59, tzinfo=TRIPOLI)

# Benghazi Dentistry (both years) studies free through 25 December 2026,
# inclusive, in Libya's local time. No subscription/payment record is changed.
BENGHAZI_FREE_ACCESS_ENDS_AT = datetime(
    2026, 12, 25, 23, 59, 59, 999999, tzinfo=TRIPOLI
)
PROGRAM_FREE_ACCESS_ENDS_AT = {
    "human-medicine": FREE_ACCESS_ENDS_AT,
    "dentistry-benghazi": BENGHAZI_FREE_ACCESS_ENDS_AT,
}
LAST_FREE_ACCESS_ENDS_AT = max(PROGRAM_FREE_ACCESS_ENDS_AT.values())


def free_access_ends_at(user: object, at: datetime | None = None) -> datetime | None:
    """Return the applicable program's live free-access deadline, if any."""

    # Check the clock before loading the cohort and program on gated requests.
    current = at or timezone.now()
    if current > LAST_FREE_ACCESS_ENDS_AT:
        return None
    cohort = getattr(user, "cohort", None)
    program = getattr(cohort, "program", None)
    if program is None:
        return None
    ends_at = PROGRAM_FREE_ACCESS_ENDS_AT.get(program.code)
    return ends_at if ends_at is not None and current <= ends_at else None

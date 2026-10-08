from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.utils import timezone

TRIPOLI = dt_timezone(timedelta(hours=2))

# Human Medicine is not on a paid plan yet; its students study free until the
# end of 23 October 2026 (Tripoli) while pricing is arranged.
FREE_ACCESS_PROGRAM_CODES = frozenset({"human-medicine"})
FREE_ACCESS_ENDS_AT = datetime(2026, 10, 23, 23, 59, 59, tzinfo=TRIPOLI)


def free_access_ends_at(user: object, at: datetime | None = None) -> datetime | None:
    """When the free window of the user's program ends, or None if it does not apply now."""

    cohort = getattr(user, "cohort", None)
    program = getattr(cohort, "program", None)
    if program is None or program.code not in FREE_ACCESS_PROGRAM_CODES:
        return None
    if (at or timezone.now()) > FREE_ACCESS_ENDS_AT:
        return None
    return FREE_ACCESS_ENDS_AT

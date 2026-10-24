from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.utils import timezone

TRIPOLI = dt_timezone(timedelta(hours=2))

# Temporary free study access for Tripoli Human Medicine batches 60 and 61.
# The human-medicine cohorts are attached to the Tripoli college in the
# education catalog; exclude other programs and cohorts.
FREE_ACCESS_PROGRAM_CODES = frozenset({"human-medicine"})
FREE_ACCESS_COHORT_CODES = frozenset({"60", "61"})
FREE_ACCESS_ENDS_AT = datetime(2027, 2, 28, 23, 59, 59, tzinfo=TRIPOLI)


def free_access_ends_at(user: object, at: datetime | None = None) -> datetime | None:
    """When the free window of the user's program ends, or None if it does not apply now."""

    cohort = getattr(user, "cohort", None)
    program = getattr(cohort, "program", None)
    if (
        program is None
        or program.code not in FREE_ACCESS_PROGRAM_CODES
        or getattr(cohort, "code", None) not in FREE_ACCESS_COHORT_CODES
    ):
        return None
    if (at or timezone.now()) > FREE_ACCESS_ENDS_AT:
        return None
    return FREE_ACCESS_ENDS_AT

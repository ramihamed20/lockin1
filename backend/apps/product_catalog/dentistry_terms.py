"""The 2026/27 University of Tripoli dentistry term plans and their offers.

Calendar facts the product owner fixed, kept in one place so pricing,
eligibility and the four-month conversion cannot disagree about them. Libya
keeps UTC+2 all year, so these instants do not move.
"""

from datetime import datetime, timedelta, timezone

TRIPOLI = timezone(timedelta(hours=2))

PRE_MIDTERM = "dentistry_pre_midterm"
POST_MIDTERM = "dentistry_post_midterm"
FULL_YEAR = "dentistry_full_year"

PRE_MIDTERM_ENDS_AT = datetime(2027, 1, 25, 23, 59, 59, tzinfo=TRIPOLI)
POST_MIDTERM_ENDS_AT = datetime(2027, 5, 21, 23, 59, 59, tzinfo=TRIPOLI)
FULL_YEAR_ENDS_AT = POST_MIDTERM_ENDS_AT

# The 5 LYD first-month offer is sold until 9 October 2026, 11:59 pm Tripoli.
FIRST_MONTH_OFFER_ENDS_AT = datetime(2026, 10, 10, 0, 0, tzinfo=TRIPOLI)

FIRST_MONTH = "lockin_first_month"
FOUR_MONTHS = "lockin_four_months"
LEGACY_DURATION_PLANS = (
    "lockin_monthly",
    FIRST_MONTH,
    "lockin_two_months",
    "lockin_three_months",
    FOUR_MONTHS,
)

# A missed installment suspends access at once; paying within this window
# restores it on submission, after it only an approved payment does.
INSTALLMENT_PAYMENT_WINDOW = timedelta(days=2)
INSTALLMENT_REMINDER_LEAD = timedelta(days=3)

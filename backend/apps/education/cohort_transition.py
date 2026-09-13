"""Cohort switching changes access scope without destroying learner-owned state."""

from django.db import transaction

from apps.accounts.models import User
from apps.accounts.roles import is_subscription_exempt

from .models import StudentCohort


@transaction.atomic
def change_student_cohort(*, user: User, cohort: StudentCohort) -> bool:
    """Move a student while preserving all account-owned study history.

    Identity, account sessions, subscriptions, purchases and payment history are
    not touched here. Reader state, annotations, progress, attempts, review data,
    and Active Study runs also remain owned by the student. Visibility is handled
    by authorization against the student's new cohort, never by deleting rows.
    """
    # Founders administer and browse every branch through operational
    # capabilities. A selected path is client-side context for them, never an
    # enrolment mutation and never a reason to clear account-owned study data.
    if is_subscription_exempt(user) or user.cohort_id == cohort.id:
        return False
    user.cohort = cohort
    user.save(update_fields=["cohort", "updated_at"])
    return True

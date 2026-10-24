from datetime import datetime, timedelta

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.models import AcademicProgram, StudentCohort
from apps.entitlements import free_access
from apps.entitlements.services import entitlement_decision

pytestmark = pytest.mark.django_db


def _student(*, program_code: str, name: str, cohort_code: str | None = None):
    user = create_user(email=f"{name}@example.com", username=name)
    cohorts = StudentCohort.objects.filter(program__code=program_code)
    if cohort_code is not None:
        cohorts = cohorts.filter(code=cohort_code)
    user.cohort = cohorts.first()
    user.save(update_fields=("cohort", "updated_at"))
    return user


@pytest.mark.parametrize("cohort_code", ("60", "61"))
def test_tripoli_medicine_batches_study_free_through_february(cohort_code: str) -> None:
    student = _student(
        program_code="human-medicine",
        name=f"med_student_{cohort_code}",
        cohort_code=cohort_code,
    )
    during = datetime(2026, 10, 24, tzinfo=free_access.TRIPOLI)
    decision = entitlement_decision(
        user=student, entitlement_code="focus.workspace", at=during
    )
    assert decision.allowed is True
    assert decision.reason == "free_access_window"
    assert decision.expires_at == free_access.FREE_ACCESS_ENDS_AT

    after = free_access.FREE_ACCESS_ENDS_AT + timedelta(seconds=1)
    assert (
        entitlement_decision(user=student, entitlement_code="focus.workspace", at=after).allowed
        is False
    )


def test_other_medicine_cohorts_are_not_covered() -> None:
    program = AcademicProgram.objects.get(code="human-medicine")
    StudentCohort.objects.create(
        program=program, code="59", name_en="Human Medicine 59", name_ar="الطب البشري 59"
    )
    student = _student(program_code="human-medicine", name="med_student_59", cohort_code="59")
    assert free_access.free_access_ends_at(student) is None


def test_other_programs_are_not_covered() -> None:
    dentist = create_user(email="dentist@example.com", username="dentist_student")
    assert free_access.free_access_ends_at(dentist) is None


def test_subscription_endpoint_reports_the_free_window(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime(2026, 10, 24, 10, tzinfo=free_access.TRIPOLI)
    monkeypatch.setattr(free_access.timezone, "now", lambda: now)
    student = _student(program_code="human-medicine", name="med_student_api", cohort_code="61")
    client = APIClient()
    client.force_authenticate(student)
    subscription = client.get("/api/v1/subscriptions/current").json()["subscription"]
    assert subscription["status"] in {"free_access", "trialing", "active"}
    assert subscription["access_exempt"] is True
    assert subscription["free_access_until"].startswith("2027-02-28")

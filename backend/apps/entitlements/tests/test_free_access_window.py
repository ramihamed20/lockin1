from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.models import StudentCohort
from apps.entitlements import free_access
from apps.entitlements.services import entitlement_decision

pytestmark = pytest.mark.django_db


def _student(*, program_code: str, name: str):
    user = create_user(email=f"{name}@example.com", username=name)
    user.cohort = StudentCohort.objects.filter(program__code=program_code).first()
    user.save(update_fields=("cohort", "updated_at"))
    return user


def test_human_medicine_studies_free_until_the_window_ends() -> None:
    student = _student(program_code="human-medicine", name="med_student")
    decision = entitlement_decision(user=student, entitlement_code="focus.workspace")
    assert decision.allowed is True
    assert decision.reason == "free_access_window"

    after = free_access.FREE_ACCESS_ENDS_AT + timedelta(seconds=1)
    assert (
        entitlement_decision(user=student, entitlement_code="focus.workspace", at=after).allowed
        is False
    )


def test_other_programs_are_not_covered() -> None:
    dentist = create_user(email="dentist@example.com", username="dentist_student")
    assert free_access.free_access_ends_at(dentist) is None


def test_subscription_endpoint_reports_the_free_window() -> None:
    student = _student(program_code="human-medicine", name="med_student_api")
    client = APIClient()
    client.force_authenticate(student)
    subscription = client.get("/api/v1/subscriptions/current").json()["subscription"]
    assert subscription["status"] in {"free_access", "trialing", "active"}
    assert subscription["access_exempt"] is True
    assert subscription["free_access_until"].startswith("2026-10-23")

"""Regression tests for the published Tripoli exam planning data."""

from datetime import date
from importlib import import_module
from types import SimpleNamespace

import pytest
from django.apps import apps
from django.db import connection

from apps.accounts.tests.helpers import create_user
from apps.education.models import StudentCohort

from ..exam_models import ExamPeriod
from .test_api import authenticated_client

pytestmark = pytest.mark.django_db

EXPECTED = {
    "60": (
        ("physiology-1", date(2026, 12, 23)),
        ("anatomy-1", date(2027, 1, 2)),
        ("histology-1", date(2027, 1, 11)),
        ("biochemistry-1", date(2027, 1, 19)),
    ),
    "61": (
        ("it", date(2026, 12, 24)),
        ("intro-anatomy", date(2027, 1, 3)),
        ("english", date(2027, 1, 12)),
        ("intro-histology", date(2027, 1, 20)),
    ),
}


@pytest.mark.parametrize("batch_code", ("60", "61"))
def test_finals_match_window_and_own_cohort(settings, monkeypatch, batch_code):
    settings.STUDY_PLAN_V2_ENABLED = True
    settings.STUDY_PLAN_V2_USER_IDS = []
    monkeypatch.setattr(
        "apps.study_plans.learning_snapshot.plan_today",
        lambda profile: date(2026, 11, 8),
    )

    cohort = StudentCohort.objects.get(program__code="human-medicine", code=batch_code)
    period = ExamPeriod.objects.get(cohort=cohort, kind="final")
    assert period.starts_on == date(2026, 12, 21)
    assert period.ends_on == date(2027, 1, 21)
    assert period.status == "confirmed"
    assert "تقديرية" in period.title

    schedules = list(period.schedules.select_related("subject").order_by("scheduled_on"))
    actual = [(row.subject.slug, row.scheduled_on) for row in schedules]
    assert actual == list(EXPECTED[batch_code])
    assert period.syllabus_scopes.count() == len(schedules)
    for exam in schedules:
        assert exam.status == "tentative"
        assert exam.exam_type == "theory"
        assert exam.starts_at is None
        assert exam.ends_at is None
        assert exam.timezone == "Africa/Tripoli"
        assert exam.subject.cohort_id == cohort.pk
        exam.full_clean()

    email = f"medicine-{batch_code}@example.test"
    user = create_user(email=email, cohort=cohort, with_trial=True)
    response = authenticated_client(user).get("/api/v1/study-plan/v2/exams")
    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) == 1
    exam_data = results[0]
    assert exam_data["id"] == str(period.pk)
    assert exam_data["kind"] == "final"
    assert exam_data["starts_on"] == "2026-12-21"
    assert exam_data["ends_on"] == "2027-01-21"
    assert all(exam["status"] == "tentative" for exam in exam_data["schedules"])
    assert all(exam["starts_at"] is None for exam in exam_data["schedules"])

    other_batch = "61" if batch_code == "60" else "60"
    other = StudentCohort.objects.get(program__code="human-medicine", code=other_batch)
    assert period.schedules.filter(subject__cohort=other).count() == 0


def test_medicine_seed_is_idempotent():
    module = "apps.study_plans.migrations.0017_tripoli_medicine_finals_2027"
    seed = import_module(module)
    cohort = StudentCohort.objects.get(program__code="human-medicine", code="60")
    period = ExamPeriod.objects.get(cohort=cohort, kind="final")
    scope = period.syllabus_scopes.first()
    scope.include_future_sheets = False
    scope.save(update_fields=["include_future_sheets"])
    ids_before = set(period.schedules.values_list("pk", flat=True))
    seed.seed_medicine_finals(apps, SimpleNamespace(connection=connection))
    assert set(period.schedules.values_list("pk", flat=True)) == ids_before
    scope.refresh_from_db()
    assert scope.include_future_sheets is False


def test_dentistry_january_midterms_remain_unchanged():
    expected = {
        "year-1": (2, 5, 9, 12, 16, 19),
        "year-2": (3, 7, 10, 14, 17, 21, 24),
    }
    for year, days in expected.items():
        cohort = StudentCohort.objects.get(
            program__code="dentistry-tripoli",
            code=year,
        )
        period = ExamPeriod.objects.get(cohort=cohort, kind="midterm")
        schedules = period.schedules.order_by("scheduled_on")
        actual = list(schedules.values_list("scheduled_on", flat=True))
        assert actual == [date(2027, 1, day) for day in days]

"""Tripoli exam planning fixtures for Medicine batches 60/61."""

from datetime import date
from importlib import import_module
from types import SimpleNamespace

import pytest
from django.apps import apps
from django.db import connection

from apps.accounts.tests.helpers import create_user
from apps.education.models import StudentCohort

from ..exam_models import ExamPeriod, ExamSchedule
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


@pytest.mark.parametrize("batch_code", ["60", "61"])
def test_medicine_exams_are_separate_cohort_plans_with_tentative_subject_dates(
    settings, monkeypatch, batch_code
):
    settings.STUDY_PLAN_V2_ENABLED = True
    settings.STUDY_PLAN_V2_USER_IDS = []
    monkeypatch.setattr(
        "apps.study_plans.learning_snapshot.plan_today", lambda profile: date(2026, 11, 8)
    )
    cohort = StudentCohort.objects.get(program__code="human-medicine", code=batch_code)
    period = ExamPeriod.objects.get(
        cohort=cohort, kind="final", starts_on=date(2026, 12, 21)
    )
    assert period.ends_on == date(2027, 1, 21)
    assert period.status == "confirmed"
    assert "تقديرية" in period.title
    schedules = list(period.schedules.select_related("subject").order_by("scheduled_on"))
    assert [(row.subject.slug, row.scheduled_on) for row in schedules] == list(
        EXPECTED[batch_code]
    )
    assert period.syllabus_scopes.count() == len(EXPECTED[batch_code])
    for row in schedules:
        assert row.status == "tentative"
        assert row.exam_type == "theory"
        assert row.starts_at is None and row.ends_at is None
        assert row.timezone == "Africa/Tripoli"
        assert row.subject.cohort_id == cohort.pk
        row.full_clean()

    user = create_user(
        email=f"medicine-{batch_code}@example.test", cohort=cohort, with_trial=True
    )
    payload = authenticated_client(user).get("/api/v1/study-plan/v2/exams")
    assert payload.status_code == 200
    results = payload.json()["results"]
    assert len(results) == 1
    assert results[0]["id"] == str(period.pk)
    assert results[0]["kind"] == "final"
    assert results[0]["starts_on"] == "2026-12-21"
    assert results[0]["ends_on"] == "2027-01-21"
    assert all(row["status"] == "tentative" for row in results[0]["schedules"])
    assert all(row["starts_at"] is None for row in results[0]["schedules"])
    other_cohort = StudentCohort.objects.get(
        program__code="human-medicine", code="61" if batch_code == "60" else "60"
    )
    assert ExamSchedule.objects.filter(
        period=period, subject__cohort=other_cohort
    ).count() == 0


def test_medicine_seed_is_idempotent_and_does_not_reset_explicit_scope():
    seed = import_module("apps.study_plans.migrations.0017_tripoli_medicine_finals_2027")
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


def test_dentistry_first_and_second_year_midterms_are_unchanged():
    expected = {
        "year-1": [2, 5, 9, 12, 16, 19],
        "year-2": [3, 7, 10, 14, 17, 21, 24],
    }
    for year, january_days in expected.items():
        cohort = StudentCohort.objects.get(
            program__code="dentistry-tripoli", code=year
        )
        period = ExamPeriod.objects.get(cohort=cohort, kind="midterm")
        assert [
            exam.scheduled_on
            for exam in period.schedules.order_by("scheduled_on")
        ] == [date(2027, 1, day) for day in january_days]

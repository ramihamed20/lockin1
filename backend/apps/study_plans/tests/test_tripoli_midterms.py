from datetime import date, time, timedelta
from importlib import import_module
from types import SimpleNamespace

import pytest
from django.apps import apps
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from apps.accounts.tests.helpers import create_user
from apps.education.models import StudentCohort

from ..exam_models import ExamPeriod, ExamSchedule
from ..learning_snapshot import student_learning_snapshot
from ..models import StudyPlanItem
from . import test_foundation as fixtures
from .test_api import authenticated_client

curriculum = fixtures.curriculum
pytestmark = pytest.mark.django_db


def test_seeded_timetables_match_faculty_dates_and_local_times(settings):
    settings.STUDY_PLAN_V2_ENABLED = True
    settings.STUDY_PLAN_V2_USER_IDS = []
    for year, days, weekday, first_subject, last_subject in (
        ("year-1", [2, 5, 9, 12, 16, 19], [5, 1], "dental-material", "physiology"),
        ("year-2", [3, 7, 10, 14, 17, 21, 24], [6, 3], "removable-prosthodontic", "microbiology"),
    ):
        cohort = StudentCohort.objects.get(program__code="dentistry-tripoli", code=year)
        period = ExamPeriod.objects.get(cohort=cohort, kind="midterm", starts_on__year=2027)
        schedules = list(period.schedules.select_related("subject"))
        assert [s.scheduled_on for s in schedules] == [date(2027, 1, day) for day in days]
        assert schedules[0].subject.slug == first_subject
        assert schedules[-1].subject.slug == last_subject
        assert period.starts_on == schedules[0].scheduled_on
        assert period.ends_on == schedules[-1].scheduled_on
        assert period.status == "confirmed"
        assert period.syllabus_scopes.count() == len(days)
        for index, schedule in enumerate(schedules):
            assert schedule.scheduled_on.weekday() == weekday[index % 2]
            assert schedule.starts_at == (time(9) if index % 2 == 0 else time(10, 30))
            assert schedule.ends_at == (time(10) if index % 2 == 0 else time(11, 30))
            assert schedule.timezone == "Africa/Tripoli"
            assert schedule.subject.cohort_id == cohort.pk
            schedule.full_clean()
        user = create_user(email=f"{year}@example.com", cohort=cohort, with_trial=True)
        response = authenticated_client(user).get("/api/v1/study-plan/v2/exams")
        assert response.status_code == 200
        payload = response.json()["results"]
        assert [p["id"] for p in payload] == [str(period.pk)]
        assert len(payload[0]["schedules"]) == len(days)
        assert payload[0]["schedules"][0]["starts_at"] == "09:00:00"
        assert payload[0]["schedules"][0]["timezone"] == "Africa/Tripoli"
    other = StudentCohort.objects.get(program__code="dentistry-benghazi", code="year-1")
    user = create_user(email="benghazi@example.com", cohort=other, with_trial=True)
    assert authenticated_client(user).get("/api/v1/study-plan/v2/exams").json()["results"] == []


def test_reapplying_seed_preserves_learner_work_and_explicit_scope():
    seed = import_module("apps.study_plans.migrations.0013_tripoli_dentistry_midterms_2027")
    period = ExamPeriod.objects.filter(cohort__program__code="dentistry-tripoli").first()
    scope = period.syllabus_scopes.first()
    scope.include_future_sheets = False
    scope.save()
    user = create_user(cohort=period.cohort, with_trial=True)
    item = StudyPlanItem.objects.create(
        user=user,
        title="Completed reading",
        scheduled_date=date(2026, 11, 4),
        status="completed",
        completed_at=timezone.now(),
        revision=4,
    )
    before = set(ExamSchedule.objects.values_list("pk", flat=True))
    seed.seed_exams(apps, SimpleNamespace(connection=connection))
    assert set(ExamSchedule.objects.values_list("pk", flat=True)) == before
    scope.refresh_from_db()
    item.refresh_from_db()
    assert scope.include_future_sheets is False
    assert item.status == "completed" and item.revision == 4


def test_snapshot_times_are_optional_and_changes_invalidate_preview(curriculum):
    period = curriculum["period"]
    schedule = ExamSchedule.objects.create(
        period=period,
        subject=curriculum["subject"],
        scheduled_on=period.starts_on,
        starts_at=time(9),
        ends_at=time(10),
        status="confirmed",
    )
    before = student_learning_snapshot(user=curriculum["user"], period=period)
    row = before["subjects"][0]["schedules"][0]
    assert row["starts_at"] == "09:00:00" and row["ends_at"] == "10:00:00"
    schedule.starts_at, schedule.ends_at = time(10, 30), time(11, 30)
    schedule.save()
    after = student_learning_snapshot(user=curriculum["user"], period=period)
    assert after["syllabus_fingerprint"] != before["syllabus_fingerprint"]
    schedule.starts_at = schedule.ends_at = None
    schedule.save()
    schedule.full_clean()
    schedule.timezone = "Invalid/Timezone"
    with pytest.raises(ValidationError, match="valid time zone"):
        schedule.full_clean()


@pytest.mark.parametrize(
    "start,end", [(time(10), time(9)), (time(9), time(9)), (time(9), None), (None, time(10))]
)
def test_invalid_time_ranges_are_rejected_by_database(curriculum, start, end):
    with pytest.raises(IntegrityError), transaction.atomic():
        ExamSchedule.objects.create(
            period=curriculum["period"],
            subject=curriculum["subject"],
            scheduled_on=curriculum["period"].starts_on + timedelta(days=1),
            starts_at=start,
            ends_at=end,
        )

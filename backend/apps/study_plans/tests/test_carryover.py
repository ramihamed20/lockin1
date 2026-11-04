from datetime import date, datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from django.core.exceptions import ValidationError
from django.utils.text import slugify

from apps.accounts.tests.helpers import create_user
from apps.content.added_subjects import add_subject
from apps.content.models import AddedCatalogSubject, CatalogDocument, CatalogSubject
from apps.content.policies import can_view_learning_object
from apps.content.tests.helpers import published_pdf
from apps.education.models import StudentCohort
from apps.education.tests.helpers import create_admin

from ..exam_models import ExamPeriod
from ..learning_snapshot import student_learning_snapshot, subject_exam_date
from ..models import PlannerRun, StudyPlanItem, StudyPlanProfile
from ..reminders import daily_plan_briefing
from ..review_priorities import review_exam_dates
from .test_api import authenticated_client
from .test_apply_preview import apply
from .test_question_preview import make_question
from .test_reading_preview import preview

pytestmark = pytest.mark.django_db


@pytest.fixture
def mixed(settings):
    settings.STUDY_PLAN_V2_ENABLED = True
    settings.STUDY_PLAN_V2_USER_IDS = []
    settings.COHORT_CONTENT_ENFORCEMENT = True
    cohort = StudentCohort.objects.get(program__code="dentistry-tripoli", code="year-2")
    period = ExamPeriod.objects.get(cohort=cohort, starts_on=date(2027, 1, 3))
    user = create_user(cohort=cohort, with_trial=True)
    admin = create_admin()
    own = CatalogSubject.objects.get(cohort=cohort, slug="pharmacy")
    carried = CatalogSubject.objects.get(
        cohort=period.carryover_period.cohort, slug="dental-material"
    )
    unselected = CatalogSubject.objects.get(cohort=carried.cohort, slug="biochemistry")

    def sheet(subject):
        result = published_pdf(actor=admin, node=subject.source_node, title=subject.title)
        version = result.published_version
        asset = version.assets.get(role="primary")
        asset.managed_file.pdf_page_count = 12
        asset.managed_file.save()
        CatalogDocument.objects.get_or_create(
            version=version,
            edition="university",
            defaults={
                "material_slug": subject.material_slug,
                "sheet_slug": slugify(subject.title),
                "managed_file": asset.managed_file,
            },
        )
        return result

    data = {
        "user": user,
        "period": period,
        "admin": admin,
        "own": own,
        "carried": carried,
        "unselected": unselected,
        "sheet": sheet(carried),
        "own_sheet": sheet(own),
        "unselected_sheet": sheet(unselected),
    }
    StudyPlanProfile.objects.create(
        user=user,
        mode="normal",
        daily_minutes=60,
        session_minutes=25,
        weekdays=list(range(7)),
        gradual_growth=False,
    )
    return data


def choose(data):
    add_subject(user=data["user"], material_slug=data["carried"].material_slug)


def snap(data):
    return student_learning_snapshot(user=data["user"], period=data["period"])


def test_only_chosen_first_year_subjects_join_the_second_year_plan(mixed):
    assert mixed["period"].carryover_period.starts_on == date(2027, 1, 2)
    before = snap(mixed)
    assert len(before["subjects"]) == 7
    assert before["sheet_count"] == 1
    assert before["exam"]["carried_subjects"] == []
    assert not can_view_learning_object(user=mixed["user"], learning_object=mixed["sheet"])
    choose(mixed)
    after = snap(mixed)
    assert len(after["subjects"]) == 8 and after["sheet_count"] == 2
    carried = next(s for s in after["subjects"] if s["is_carryover"])
    assert carried["subject_id"] == str(mixed["carried"].pk)
    assert carried["schedules"][0]["scheduled_on"] == "2027-01-02"
    assert after["exam"]["first_exam_on"] == "2027-01-02"
    assert after["syllabus_fingerprint"] != before["syllabus_fingerprint"]
    assert can_view_learning_object(user=mixed["user"], learning_object=mixed["sheet"])
    assert not can_view_learning_object(
        user=mixed["user"], learning_object=mixed["unselected_sheet"]
    )
    client = authenticated_client(mixed["user"])
    exams = client.get("/api/v1/study-plan/v2/exams").json()["results"]
    assert [exam["id"] for exam in exams] == [str(mixed["period"].pk)]
    assert len(exams[0]["schedules"]) == 8
    assert sum(row["is_carryover"] for row in exams[0]["schedules"]) == 1
    # A carried subject never grants the entire First Year exam or syllabus.
    assert (
        client.get(
            f"/api/v1/study-plan/v2/exams/{mixed['period'].carryover_period_id}/snapshot"
        ).status_code
        == 404
    )
    assert mixed["user"].cohort_id == mixed["period"].cohort_id


def test_mixed_reading_and_questions_use_one_budget_and_their_own_deadlines(mixed):
    choose(mixed)
    question = make_question(mixed)
    result = preview(mixed, include_questions=True)
    assert result.status_code == 200, result.json()
    value = result.json()
    assert value["required_reading_minutes"] == 120
    subjects = {task["subject_id"] for task in value["assignments"]}
    assert subjects == {str(mixed["carried"].pk), str(mixed["own"].pk)}
    assert value["unscheduled"] == []
    for task in value["assignments"]:
        deadline = "2027-01-01" if task["subject_id"] == str(mixed["carried"].pk) else "2027-01-06"
        assert task["scheduled_date"] <= deadline
        if task["activity"] == "reading":
            assert task["deadline"] == deadline
    for day in value["days"]:
        assert day["allocated_minutes"] + day["existing_minutes"] <= 60
        if day["date"] in ("2027-01-02", "2027-01-03"):
            assert day["available_minutes"] == 0
        if day["date"] == "2027-01-05":  # Unselected First Year exam is not a rest day.
            assert day["available_minutes"] == 60
    task = next(task for task in value["assignments"] if task["activity"] == "questions")
    assert task["question_ids"] == [str(question.pk)]
    assert mixed["carried"].material_slug in task["start_url"]
    saved = apply(mixed, value, include_questions=True)
    assert saved.status_code == 200, saved.json()
    for item in StudyPlanItem.objects.filter(user=mixed["user"]):
        item.full_clean()
    assert PlannerRun.objects.get(user=mixed["user"]).period_id == mixed["period"].pk


def test_subject_removal_invalidates_preview_and_new_reading_reports(mixed):
    choose(mixed)
    value = preview(mixed).json()
    assert apply(mixed, value).status_code == 200
    task = (
        StudyPlanItem.objects.filter(
            user=mixed["user"], catalog_subject=mixed["carried"], activity="reading"
        )
        .order_by("scheduled_date")
        .first()
    )
    before_count = StudyPlanItem.objects.filter(user=mixed["user"]).count()
    # A fresh preview, then the existing addition is revoked by an operator.
    fresh = preview(mixed).json()
    AddedCatalogSubject.objects.filter(user=mixed["user"], subject=mixed["carried"]).delete()
    assert apply(mixed, fresh).status_code == 409
    assert StudyPlanItem.objects.filter(user=mixed["user"]).count() == before_count
    assert not any(subject["is_carryover"] for subject in snap(mixed)["subjects"])
    report = authenticated_client(mixed["user"]).post(
        f"/api/v1/study-plan/items/{task.pk}/progress",
        {
            "client_request_id": str(uuid4()),
            "expected_revision": task.revision,
            "page_end": task.page_start,
            "minutes": 1,
        },
        format="json",
    )
    assert report.status_code == 400
    task.refresh_from_db()
    assert task.status == "planned" and task.completed_page_end is None


def test_partial_reading_of_a_carried_subject_saves_normally(mixed):
    choose(mixed)
    value = preview(mixed).json()
    assert apply(mixed, value).status_code == 200
    task = (
        StudyPlanItem.objects.filter(
            user=mixed["user"], catalog_subject=mixed["carried"], activity="reading"
        )
        .order_by("scheduled_date")
        .first()
    )
    task.scheduled_date = date.fromisoformat(value["today"])
    task.save()
    response = authenticated_client(mixed["user"]).post(
        f"/api/v1/study-plan/items/{task.pk}/progress",
        {
            "client_request_id": str(uuid4()),
            "expected_revision": task.revision,
            "page_end": task.page_start,
            "minutes": 5,
        },
        format="json",
    )
    assert response.status_code == 200, response.json()
    task.refresh_from_db()
    assert task.completed_page_end == task.page_start
    assert task.revision == 2


@pytest.mark.parametrize("change", ["draft", "inactive", "wrong_program", "wrong_kind"])
def test_unavailable_or_invalid_source_period_never_expands_the_plan(mixed, change):
    choose(mixed)
    source = mixed["period"].carryover_period
    if change == "draft":
        source.status = "draft"
        source.save()
    elif change == "inactive":
        source.cohort.is_active = False
        source.cohort.save()
    else:
        if change == "wrong_program":
            source.cohort = StudentCohort.objects.get(
                program__code="dentistry-benghazi", code="year-1"
            )
        else:
            source.kind = "final"
        source.save()
        with pytest.raises(ValidationError, match="same dentistry program"):
            mixed["period"].full_clean()
    value = snap(mixed)
    assert len(value["subjects"]) == 7
    assert value["exam"]["carryover_enabled"] is False
    assert value["exam"]["carried_subjects"] == []


def test_missing_subject_date_uses_the_first_year_period_fallback(mixed):
    choose(mixed)
    mixed["period"].carryover_period.schedules.filter(subject=mixed["carried"]).delete()
    subject = next(subject for subject in snap(mixed)["subjects"] if subject["is_carryover"])
    assert subject["schedules"] == []
    assert subject_exam_date(subject, mixed["period"]) == date(2027, 1, 2)
    result = preview(mixed).json()
    assert all(
        task["deadline"] == "2027-01-01"
        for task in result["assignments"]
        if task["subject_id"] == str(mixed["carried"].pk)
    )


def test_carried_subjects_reach_reminders_and_exam_review_priority(mixed):
    choose(mixed)
    value = preview(mixed).json()
    assert apply(mixed, value).status_code == 200
    today = date.fromisoformat(value["today"])
    planned = StudyPlanItem.objects.filter(
        user=mixed["user"], scheduled_date=today, status="planned"
    )
    briefing = daily_plan_briefing(user=mixed["user"], today=today)
    assert briefing["count"] == planned.count()
    assert briefing["minutes"] == sum(item.duration_minutes for item in planned)
    key = f"catalog:{mixed['carried'].material_slug}"
    now = datetime(2027, 1, 1, tzinfo=ZoneInfo("Africa/Tripoli"))
    priorities = review_exam_dates(user=mixed["user"], now=now)
    assert priorities[key] == date(2027, 1, 2)
    assert f"catalog:{mixed['unselected'].material_slug}" not in priorities
    AddedCatalogSubject.objects.filter(user=mixed["user"]).delete()
    assert key not in review_exam_dates(user=mixed["user"], now=now)

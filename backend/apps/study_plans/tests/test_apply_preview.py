from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone

from apps.accounts.tests.helpers import create_user
from apps.content.models import ActiveStudyQuestionContent, CatalogDocument
from apps.review.models import ReviewAnswerLog, ReviewItem

from ..models import PlannerRun, StudyPlanItem
from ..services import plan_today
from . import test_foundation as fixtures
from .test_api import authenticated_client
from .test_reading_preview import preview, setup_plan

curriculum = fixtures.curriculum
pytestmark = pytest.mark.django_db


def apply(data, value, request_id=None, **patch):
    return authenticated_client(data["user"]).post(
        f"/api/v1/study-plan/v2/exams/{data['period'].pk}/apply",
        {
            "preview_token": value["apply_token"],
            "client_request_id": str(request_id or uuid4()),
            "edition": "university",
            **patch,
        },
        format="json",
    )


def test_apply_preserves_manual_completed_items_and_replays_original_receipt(curriculum):
    profile = setup_plan(curriculum)
    manual = StudyPlanItem.objects.create(
        user=curriculum["user"],
        title="Keep me",
        scheduled_date=plan_today(profile),
        duration_minutes=5,
        status="completed",
        completed_at=timezone.now(),
    )
    value = preview(curriculum).json()
    request_id = uuid4()
    first = apply(curriculum, value, request_id)
    assert first.status_code == 200, first.json()
    assert first.json()["created_count"] == len(value["assignments"])
    assert first.json()["persisted"] is True
    assert apply(curriculum, value, request_id).json() == first.json()
    assert StudyPlanItem.objects.count() == 1 + len(value["assignments"])
    manual.refresh_from_db()
    assert manual.status == "completed" and manual.revision == 1
    assert PlannerRun.objects.filter(user=curriculum["user"]).count() == 1
    refreshed = preview(curriculum).json()
    assert refreshed["required_reading_minutes"] == 0
    assert refreshed["assignments"] == []


def test_stale_preview_rejects_without_writes_and_conflicting_replay_is_denied(curriculum):
    profile = setup_plan(curriculum)
    value = preview(curriculum).json()
    profile.daily_minutes += 10
    profile.revision += 1
    profile.save()
    assert apply(curriculum, value).status_code == 409
    assert not PlannerRun.objects.exists() and not StudyPlanItem.objects.exists()
    current = preview(curriculum).json()
    request_id = uuid4()
    assert apply(curriculum, current, request_id).status_code == 200
    assert apply(curriculum, current, request_id, edition="lockin").status_code == 409


def test_changed_block_length_keeps_saved_pages_and_only_adds_uncovered_pages(curriculum):
    profile = setup_plan(curriculum, pages=12)
    value = preview(curriculum).json()
    assert apply(curriculum, value).status_code == 200
    # An explicit deletion requests replacement only for those pages.
    item = StudyPlanItem.objects.filter(page_start=6).get()
    item.delete()
    profile.session_minutes = 10
    profile.revision += 1
    profile.save()
    next_preview = preview(curriculum).json()
    covered = [
        page
        for task in next_preview["assignments"]
        for page in range(task["page_start"], task["page_end"] + 1)
    ]
    assert covered == [6, 7, 8, 9, 10]
    assert apply(curriculum, next_preview).status_code == 200
    all_pages = [
        page
        for task in StudyPlanItem.objects.all()
        for page in range(task.page_start, task.page_end + 1)
    ]
    assert sorted(all_pages) == list(range(1, 13))


def due(data):
    bank = ActiveStudyQuestionContent.objects.create(
        sheet=data["sheet"],
        source_version=data["sheet"].published_version,
        difficulty="easy",
        payload={},
        plan_signature={},
        checkpoint_question_count=1,
        final_exam_question_count=1,
        created_by=data["admin"],
        updated_by=data["admin"],
    )
    return ReviewItem.objects.create(
        user=data["user"],
        canonical_key=f"active-study:{data['sheet'].pk}:easy:bank:{bank.revision}:page:1:1",
        source_type="active_study",
        source_id=str(data["sheet"].pk),
        subject_key="catalog:d2-anatomy",
        subject_label_snapshot="Anatomy",
        first_mistake_at=timezone.now(),
        last_mistake_at=timezone.now(),
        next_review_at=timezone.now() - timedelta(days=1),
    )


def test_review_time_is_reserved_and_scored_completion_is_applied_once(curriculum):
    profile = setup_plan(curriculum)
    review = due(curriculum)
    value = preview(curriculum, include_reviews=True).json()
    assert value["scheduled_review_minutes"] == 5
    assert value["days"][0]["allocated_minutes"] == 30
    assert apply(curriculum, value, include_reviews=True).status_code == 200
    task = StudyPlanItem.objects.get(review_item=review)
    ReviewAnswerLog.objects.create(
        user=curriculum["user"],
        review_item=review,
        idempotency_key=uuid4(),
        context="review_bank",
        was_correct=True,
        answered_at=timezone.now(),
    )
    today = plan_today(profile)
    query = f"/api/v1/study-plan?from={today}&to={today}"
    client = authenticated_client(curriculum["user"])
    assert (
        client.patch(
            f"/api/v1/study-plan/items/{task.pk}",
            {"title": "Renamed after answering", "expected_revision": 1},
            format="json",
        ).status_code
        == 200
    )
    assert client.get(query).status_code == 200
    task.refresh_from_db()
    assert task.status == "completed" and task.revision == 3
    client.get(query)
    task.refresh_from_db()
    assert task.revision == 3 and ReviewAnswerLog.objects.count() == 1
    assert (
        client.patch(
            f"/api/v1/study-plan/items/{task.pk}",
            {"status": "planned", "expected_revision": 3},
            format="json",
        ).status_code
        == 200
    )
    client.get(query)
    task.refresh_from_db()
    assert task.status == "planned"  # Later manual reopen wins.


def test_apply_is_cohort_scoped_flagged_and_retry_survives_exam_expiry(curriculum, settings):
    setup_plan(curriculum)
    value = preview(curriculum).json()
    path = f"/api/v1/study-plan/v2/exams/{curriculum['period'].pk}/apply"
    other = create_user(email="other-plan@example.com", with_trial=True)
    body = {
        "preview_token": value["apply_token"],
        "client_request_id": str(uuid4()),
        "edition": "university",
    }
    assert authenticated_client(other).post(path, body, format="json").status_code == 404
    request_id = uuid4()
    original = apply(curriculum, value, request_id)
    curriculum["period"].starts_on = timezone.localdate() - timedelta(days=2)
    curriculum["period"].save()
    assert apply(curriculum, value, request_id).json() == original.json()
    settings.STUDY_PLAN_V2_ENABLED = False
    assert apply(curriculum, value, request_id).status_code == 403


def test_saved_reader_target_does_not_silently_open_a_different_version(curriculum):
    profile = setup_plan(curriculum)
    version = curriculum["sheet"].published_version
    asset = version.assets.get(role="primary")
    doc = CatalogDocument.objects.create(
        material_slug="d2-anatomy",
        sheet_slug="intro",
        version=version,
        managed_file=asset.managed_file,
    )
    value = preview(curriculum).json()
    assert apply(curriculum, value).status_code == 200
    today = plan_today(profile)
    client = authenticated_client(curriculum["user"])
    path = f"/api/v1/study-plan?from={today}&to={today}"
    payload = client.get(path).json()["results"][0]
    assert f"studyVersion={version.pk}" in payload["start_url"]
    doc.is_active = False
    doc.save()
    assert client.get(path).json()["results"][0]["start_url"] is None


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_concurrent_identical_applies_create_one_run(monkeypatch):
    """Test the PostgreSQL lock boundary; real selectors are covered above."""
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.contrib.auth.models import Group
    from django.db import close_old_connections, connection

    from apps.accounts.roles import Role
    from apps.education.models import AcademicProgram, StudentCohort
    from apps.education.services import create_node
    from apps.education.tests.helpers import create_admin

    from ..apply_preview import apply_preview
    from ..exam_models import ExamPeriod

    if connection.vendor != "postgresql":
        pytest.skip("Requires PostgreSQL account-row locking")
    # Transactional tests can follow a flush of migration-seeded groups.
    Group.objects.get_or_create(name=Role.ADMINISTRATOR.value)
    admin = create_admin(email=f"planner-admin-{uuid4()}@example.com")
    institution = create_node(
        actor=admin, parent=None, kind="institution", title="Planner lock test"
    )
    program = AcademicProgram.objects.create(
        code=f"lock-{uuid4().hex[:10]}", name_en="Lock test", name_ar="اختبار"
    )
    cohort = StudentCohort.objects.create(
        program=program, code="lock", name_en="Lock", name_ar="اختبار"
    )
    user = create_user(email=f"planner-{uuid4()}@example.com", cohort=cohort, with_trial=False)
    period = ExamPeriod.objects.create(
        institution=institution,
        cohort=cohort,
        starts_on=timezone.localdate() + timedelta(days=10),
        title="Lock test",
    )
    source = {
        "apply_token": "a" * 64,
        "assignments": [
            {
                "key": "lock-test-activity",
                "subject_id": None,
                "title": "Lock test",
                "activity": "manual",
                "scheduled_date": str(timezone.localdate()),
                "estimated_minutes": 25,
            }
        ],
        "unscheduled": [],
        "issues": [],
    }
    monkeypatch.setattr(
        "apps.study_plans.apply_preview.reading_plan_preview", lambda **_kwargs: source
    )
    request_id, gate = uuid4(), Barrier(2)

    def worker():
        close_old_connections()
        try:
            gate.wait(timeout=10)
            return apply_preview(
                user=user,
                period=period,
                client_request_id=request_id,
                preview_token=source["apply_token"],
                edition="university",
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        left, right = list(pool.map(lambda _: worker(), range(2)))
    assert left == right
    assert PlannerRun.objects.filter(user=user).count() == 1
    assert StudyPlanItem.objects.filter(user=user).count() == left["created_count"]


def test_apply_requires_session_csrf_and_preview_belongs_to_the_account(curriculum):
    from rest_framework.test import APIClient

    from ..models import StudyPlanProfile

    setup_plan(curriculum)
    value = preview(curriculum).json()
    path = f"/api/v1/study-plan/v2/exams/{curriculum['period'].pk}/apply"
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(curriculum["user"])
    assert client.get("/api/v1/study-plan/v2/exams").status_code == 200
    body = {
        "preview_token": value["apply_token"],
        "client_request_id": str(uuid4()),
        "edition": "university",
    }
    assert client.post(path, body, format="json").status_code == 403
    friend = create_user(
        email="same-cohort-plan@example.com", cohort=curriculum["user"].cohort, with_trial=True
    )
    StudyPlanProfile.objects.create(
        user=friend, mode="normal", daily_minutes=30, session_minutes=25, weekdays=list(range(7))
    )
    assert authenticated_client(friend).post(path, body, format="json").status_code == 409
    assert not PlannerRun.objects.exists()

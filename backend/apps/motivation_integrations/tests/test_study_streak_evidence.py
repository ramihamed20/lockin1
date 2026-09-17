"""The streak counts days a student studied, so studying has to reach it.

`UserStreak` is a projection of `StreakActivity`, and the projection was always
correct -- nothing was writing the evidence. The two flows a student actually
uses, reading a sheet and Active Study, recorded none, so the streak read zero
however much they studied. These tests assert the evidence now arrives from both
and that the summary endpoint reports it.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.content.active_study import plan_payload
from apps.content.models import ActiveStudyQuestionContent, ActiveStudySettings, LearningObject
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, published_path
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.focus.managed_active_study import (
    answer,
    complete_part_reading,
    questions,
    start,
    submit,
)
from apps.focus.models import FocusSession
from apps.focus.services import complete_owned_focus_session, start_workspace_session
from apps.streaks.models import StreakActivity, UserStreak

pytestmark = pytest.mark.django_db


def _question(label: str) -> dict[str, object]:
    return {
        "question": f"Question {label}?",
        "options": {"A": f"A {label}", "B": f"B {label}", "C": f"C {label}", "D": f"D {label}"},
        "correct_answer": "B",
        "explanation": f"Explanation {label}.",
    }


def _content_payload(parts: int = 4) -> dict[str, object]:
    return {
        "parts": [
            {"part": part, "questions": [_question(f"P{part}-{index}") for index in range(1, 16)]}
            for part in range(1, parts + 1)
        ],
        "final_exam": {"questions": [_question(f"F-{index}") for index in range(1, 51)]},
    }


def _active_study_sheet() -> tuple[User, LearningObject]:
    admin = create_admin(email="streak-evidence-admin@example.com")
    _, subject, _ = published_path(admin=admin)
    sheet = published_pdf(actor=admin, node=subject, title="Streak evidence PDF")
    ActiveStudySettings.objects.create(
        sheet=sheet, enabled=True, total_pdf_pages=22, excluded_start_pages=1
    )
    plan = plan_payload(total_pdf_pages=22, excluded_start_pages=1, excluded_end_pages=0)
    medium = next(item for item in plan["difficulties"] if item["difficulty"] == "medium")
    ActiveStudyQuestionContent.objects.create(
        sheet=sheet,
        difficulty="medium",
        payload=_content_payload(),
        plan_signature={
            "number_of_parts": medium["number_of_parts"],
            "page_ranges": medium["page_ranges"],
        },
        checkpoint_question_count=60,
        final_exam_question_count=50,
        created_by=admin,
        updated_by=admin,
    )
    return admin, sheet


def _grant_focus(user: User) -> None:
    EntitlementGrant.objects.create(
        user=user,
        entitlement=EntitlementDefinition.objects.get(code="focus.workspace"),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
    )


def _pass_checkpoint(user: User, sheet: LearningObject) -> Any:
    run, _ = start(user=user, sheet_id=sheet.id, difficulty="medium")
    complete_part_reading(user=user, run_id=run.id)
    payload = questions(user=user, run_id=run.id)
    for item in payload["questions"]:
        answer(
            user=user,
            run_id=run.id,
            attempt_id=payload["attempt_id"],
            position=item["position"],
            selected_answer="B",
        )
    return submit(user=user, run_id=run.id, attempt_id=payload["attempt_id"])


def test_a_passed_active_study_checkpoint_records_a_study_day(
    django_capture_on_commit_callbacks: Any,
) -> None:
    _, sheet = _active_study_sheet()
    student = create_user(email="streak-active-study@example.com")

    with django_capture_on_commit_callbacks(execute=True):
        _, result = _pass_checkpoint(student, sheet)

    assert result["passed"] is True
    activities = list(StreakActivity.objects.filter(user=student))
    assert [activity.activity_type for activity in activities] == ["assessment.passed"]
    assert activities[0].qualified_on == timezone.now().date()
    state = UserStreak.objects.get(user=student)
    # The whole point: a student who studied today is on a one-day streak, not
    # a zero-day one, and it came from stored evidence rather than a constant.
    assert state.current_days == 1
    assert state.longest_days == 1

    summary = APIClient()
    summary.force_authenticate(student)
    response = summary.get("/api/v1/progression/streak")

    assert response.status_code == 200
    assert response.json()["current_days"] == 1


def test_the_same_attempt_cannot_be_counted_twice(
    django_capture_on_commit_callbacks: Any,
) -> None:
    _, sheet = _active_study_sheet()
    student = create_user(email="streak-active-study-replay@example.com")

    with django_capture_on_commit_callbacks(execute=True):
        run, _ = _pass_checkpoint(student, sheet)
    attempt = run.attempts.first()
    assert attempt is not None
    with django_capture_on_commit_callbacks(execute=True):
        submit(user=student, run_id=run.id, attempt_id=attempt.id)

    # Deduplicated on the attempt, which is created once. Re-submitting is a
    # replay, and a replay is not another day of study.
    assert StreakActivity.objects.filter(user=student).count() == 1
    assert UserStreak.objects.get(user=student).current_days == 1


def test_a_reading_sitting_of_twenty_minutes_records_a_study_day(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin, sheet = _active_study_sheet()
    student = create_user(email="streak-reading@example.com")
    _grant_focus(student)
    version = sheet.published_version
    assert version is not None

    from apps.focus.integrations import resolve_focus_document

    document = resolve_focus_document(user=student, document_version_id=version.id)
    session, _, created = start_workspace_session(
        user=student, document=document, client_instance_id=uuid4()
    )
    assert created
    # The reader sat with the sheet. Only the server's own activity log decides
    # how long that was, so the start is moved rather than a duration claimed.
    FocusSession.objects.filter(id=session.id).update(
        started_at=timezone.now() - timedelta(minutes=25)
    )
    session.timeline.update(occurred_at=timezone.now() - timedelta(minutes=25))

    with django_capture_on_commit_callbacks(execute=True):
        completed = complete_owned_focus_session(user=student, session_id=session.id)

    assert completed.active_duration_seconds >= 1_200
    assert [activity.activity_type for activity in StreakActivity.objects.filter(user=student)] == [
        "focus.deep_session"
    ]
    assert UserStreak.objects.get(user=student).current_days == 1


def test_a_reading_sitting_left_open_is_settled_when_the_next_one_starts(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin, sheet = _active_study_sheet()
    student = create_user(email="streak-reading-abandoned@example.com")
    _grant_focus(student)
    version = sheet.published_version
    assert version is not None

    from apps.focus.integrations import resolve_focus_document

    document = resolve_focus_document(user=student, document_version_id=version.id)
    first, _, _ = start_workspace_session(
        user=student, document=document, client_instance_id=uuid4()
    )
    # A reader who closed the tab: started long ago, last seen 30 minutes after
    # that, and never completed.
    opened = timezone.now() - timedelta(days=1)
    FocusSession.objects.filter(id=first.id).update(
        started_at=opened, last_activity_at=opened + timedelta(minutes=30)
    )
    first.timeline.update(occurred_at=opened)

    with django_capture_on_commit_callbacks(execute=True):
        start_workspace_session(user=student, document=document, client_instance_id=uuid4())

    settled = FocusSession.objects.get(id=first.id)
    assert settled.status == FocusSession.Status.COMPLETED
    # Measured to its last activity, not to now: an idle tab must not be
    # credited with the hours it sat there, or with the wrong day.
    assert 1_700 <= settled.active_duration_seconds <= 1_900
    activity = StreakActivity.objects.get(user=student)
    assert activity.activity_type == "focus.deep_session"
    assert activity.qualified_on == (opened + timedelta(minutes=30)).date()

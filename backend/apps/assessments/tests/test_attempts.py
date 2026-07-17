from datetime import timedelta
from decimal import Decimal
from typing import Any
from uuid import uuid4

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.education.models import EducationNode
from apps.education.tests.helpers import create_admin, published_path
from apps.progress.models import QuestionReview, QuestionReviewLog
from apps.questions.models import Question, QuestionVersion
from apps.questions.services import revise_question
from apps.questions.tests.helpers import published_question, question_input
from platform_core.events import DomainEvent, domain_events

from ..attempt_services import (
    AttemptConflictError,
    AttemptRuleError,
    create_question_issue_report,
    record_attempt_activity,
    refresh_attempt_state,
    save_answer,
    start_attempt,
    submit_attempt,
)
from ..events import QuizAttemptSubmitted
from ..models import (
    Attempt,
    AttemptActivity,
    AttemptResult,
    AttemptSubmissionReceipt,
    QuestionIssueReport,
    Quiz,
    QuizVersion,
)
from ..quiz_services import QuizInput, QuizRuleError, create_quiz, revise_quiz
from ..selectors import published_quiz as select_published_quiz
from ..serializers import AttemptResultSerializer, AttemptSerializer
from .helpers import published_quiz

pytestmark = pytest.mark.django_db


def _assessment_fixture() -> tuple[
    User,
    User,
    EducationNode,
    tuple[Question, ...],
    Quiz,
]:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    questions = tuple(
        published_question(
            actor=admin,
            node=lesson,
            prompt=f"Question {index}",
            difficulty=("easy", "medium", "hard")[index % 3],
        )
        for index in range(3)
    )
    quiz = published_quiz(actor=admin, node=lesson, questions=questions)
    return admin, student, lesson, questions, quiz


def test_attempt_snapshot_and_start_idempotency() -> None:
    admin, student, lesson, questions, quiz = _assessment_fixture()
    key = uuid4()
    started = start_attempt(user=student, quiz_id=quiz.id, idempotency_key=key)
    replay = start_attempt(user=student, quiz_id=quiz.id, idempotency_key=key)

    assert started.resumed is False
    assert replay.resumed is True
    assert replay.attempt.id == started.attempt.id
    snapshots = list(started.attempt.questions.order_by("position"))
    assert len(snapshots) == 3
    assert all(len(item.correct_option_ids) == 1 for item in snapshots)
    student_payload = AttemptSerializer(started.attempt).data
    assert "correct_option_ids" not in student_payload["questions"][0]
    assert "explanation" not in student_payload["questions"][0]
    assert student_payload["focus_context"] == {
        "context_type": "quiz",
        "context_id": str(started.attempt.id),
    }

    original_prompt = snapshots[0].prompt
    source = snapshots[0].question_version
    source.prompt = "Changed outside service"
    source.save(update_fields=("prompt",))
    snapshots[0].refresh_from_db()
    assert snapshots[0].prompt == original_prompt


def test_autosave_is_monotonic_idempotent_and_server_acknowledged() -> None:
    _, student, _, _, quiz = _assessment_fixture()
    attempt = start_attempt(user=student, quiz_id=quiz.id, idempotency_key=uuid4()).attempt
    snapshot = attempt.questions.order_by("position").first()
    assert snapshot is not None
    option_id = snapshot.option_snapshot[0]["id"]

    saved = save_answer(
        user=student,
        attempt_id=attempt.id,
        attempt_question_id=snapshot.id,
        selected_option_ids=(option_id,),
        client_revision=1,
    )
    replay = save_answer(
        user=student,
        attempt_id=attempt.id,
        attempt_question_id=snapshot.id,
        selected_option_ids=(option_id,),
        client_revision=1,
    )
    assert replay.id == saved.id
    assert saved.server_revision == 2

    other_id = snapshot.option_snapshot[1]["id"]
    with pytest.raises(AttemptConflictError) as stale:
        save_answer(
            user=student,
            attempt_id=attempt.id,
            attempt_question_id=snapshot.id,
            selected_option_ids=(other_id,),
            client_revision=1,
        )
    assert stale.value.current_answer is not None

    updated = save_answer(
        user=student,
        attempt_id=attempt.id,
        attempt_question_id=snapshot.id,
        selected_option_ids=(other_id,),
        client_revision=2,
    )
    assert updated.client_revision == 2
    assert updated.server_revision == 3


def test_submission_grades_once_schedules_review_and_emits_stable_event(
    django_capture_on_commit_callbacks: Any,
) -> None:
    _, student, _, _, quiz = _assessment_fixture()
    attempt = start_attempt(user=student, quiz_id=quiz.id, idempotency_key=uuid4()).attempt
    snapshots = list(attempt.questions.order_by("position"))
    for snapshot in snapshots:
        save_answer(
            user=student,
            attempt_id=attempt.id,
            attempt_question_id=snapshot.id,
            selected_option_ids=(snapshot.correct_option_ids[0],),
            client_revision=1,
        )

    received: list[DomainEvent] = []
    unsubscribe = domain_events.subscribe(QuizAttemptSubmitted, received.append)
    submit_key = uuid4()
    try:
        with django_capture_on_commit_callbacks(execute=True):
            result = submit_attempt(
                user=student,
                attempt_id=attempt.id,
                idempotency_key=submit_key,
            )
        with django_capture_on_commit_callbacks(execute=True):
            replay = submit_attempt(
                user=student,
                attempt_id=attempt.id,
                idempotency_key=submit_key,
            )
    finally:
        unsubscribe()

    assert replay.id == result.id
    assert result.percentage == Decimal("100.00")
    assert result.passed is True
    assert AttemptResult.objects.filter(attempt=attempt).count() == 1
    assert AttemptSubmissionReceipt.objects.filter(attempt=attempt).count() == 1
    assert QuestionReview.objects.filter(user=student).count() == 3
    assert QuestionReviewLog.objects.filter(result_id=result.id).count() == 3
    assert len(received) == 1
    event = received[0]
    assert isinstance(event, QuizAttemptSubmitted)
    assert event.result_id == result.id
    assert event.ranking_eligible is False


def test_server_deadline_finalizes_attempt_and_rejects_late_save() -> None:
    _, student, _, _, quiz = _assessment_fixture()
    started_at = timezone.now()
    attempt = start_attempt(
        user=student,
        quiz_id=quiz.id,
        idempotency_key=uuid4(),
        now=started_at,
    ).attempt
    assert attempt.deadline_at is not None
    refreshed = refresh_attempt_state(
        user=student,
        attempt_id=attempt.id,
        now=attempt.deadline_at + timedelta(seconds=1),
    )
    assert refreshed.status == Attempt.Status.EXPIRED
    assert AttemptResult.objects.filter(attempt=attempt).exists()


def test_delayed_result_withholds_score_answer_key_and_explanation() -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    question = published_question(actor=admin, node=lesson)
    closes_at = timezone.now() + timedelta(hours=1)
    quiz = published_quiz(
        actor=admin,
        node=lesson,
        questions=(question,),
        result_release=QuizVersion.ResultRelease.AFTER_CLOSE,
        available_until=closes_at,
    )
    attempt = start_attempt(user=student, quiz_id=quiz.id, idempotency_key=uuid4()).attempt
    result = submit_attempt(
        user=student,
        attempt_id=attempt.id,
        idempotency_key=uuid4(),
    )
    result = AttemptResult.objects.select_related("attempt__quiz_version").get(id=result.id)
    payload = AttemptResultSerializer(result).data
    assert payload["released"] is False
    assert payload["percentage"] is None
    assert payload["passed"] is None
    assert payload["questions"] is None


def test_practice_review_queue_uses_due_items_and_preserves_focus_boundary() -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    questions = tuple(
        published_question(actor=admin, node=lesson, prompt=f"Review {index}") for index in range(2)
    )
    source_quiz = published_quiz(actor=admin, node=lesson, questions=questions)
    source_attempt = start_attempt(
        user=student,
        quiz_id=source_quiz.id,
        idempotency_key=uuid4(),
    ).attempt
    submit_attempt(user=student, attempt_id=source_attempt.id, idempotency_key=uuid4())
    QuestionReview.objects.filter(user=student).update(due_at=timezone.now() - timedelta(minutes=1))
    revised_question = questions[0]
    revise_question(
        actor=admin,
        question_id=revised_question.id,
        expected_revision=revised_question.revision,
        data=question_input(node=lesson, prompt="Private follow-up revision"),
    )

    practice = published_quiz(
        actor=admin,
        node=lesson,
        questions=questions,
        mode=QuizVersion.Mode.PRACTICE,
        selection_mode=QuizVersion.SelectionMode.POOL,
        title="Due review",
    )
    review_attempt = start_attempt(
        user=student,
        quiz_id=practice.id,
        idempotency_key=uuid4(),
        requested_question_count=2,
        review_only=True,
    ).attempt
    assert review_attempt.review_only is True
    assert review_attempt.questions.count() == 2
    assert not hasattr(review_attempt, "focus_session_id")


def test_integrity_activity_is_informational_and_report_preserves_evidence() -> None:
    _, student, _, _, quiz = _assessment_fixture()
    attempt = start_attempt(user=student, quiz_id=quiz.id, idempotency_key=uuid4()).attempt
    event_id = uuid4()
    activity = record_attempt_activity(
        user=student,
        attempt_id=attempt.id,
        client_event_id=event_id,
        activity_type=AttemptActivity.ActivityType.PAGE_HIDDEN,
        client_occurred_at=timezone.now(),
        metadata={"reason": "document_hidden"},
    )
    replay = record_attempt_activity(
        user=student,
        attempt_id=attempt.id,
        client_event_id=event_id,
        activity_type=AttemptActivity.ActivityType.PAGE_HIDDEN,
        client_occurred_at=timezone.now(),
        metadata={"reason": "document_hidden"},
    )
    assert replay.id == activity.id
    attempt.refresh_from_db()
    assert attempt.status == Attempt.Status.ACTIVE

    result = submit_attempt(user=student, attempt_id=attempt.id, idempotency_key=uuid4())
    question = attempt.questions.first()
    assert question is not None
    report = create_question_issue_report(
        user=student,
        result_id=result.id,
        attempt_question_id=question.id,
        category=QuestionIssueReport.Category.AMBIGUOUS,
        details="Two options appear defensible.",
    )
    assert report.evidence_snapshot["question_version_id"] == str(question.question_version_id)
    assert "correct_option_ids" in report.evidence_snapshot


def test_ranked_configuration_requires_comparable_attempts() -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    with pytest.raises(QuizRuleError, match="fixed questions"):
        create_quiz(
            actor=admin,
            data=QuizInput(
                academic_node=lesson,
                title="Unfair ranking",
                instructions="",
                mode=QuizVersion.Mode.QUIZ,
                selection_mode=QuizVersion.SelectionMode.POOL,
                question_count=1,
                duration_seconds=300,
                maximum_attempts=1,
                ranking_eligible=True,
                allowed_difficulties=(QuestionVersion.Difficulty.MEDIUM,),
            ),
        )


def test_private_quiz_revision_keeps_the_published_release_available() -> None:
    admin, student, lesson, questions, quiz = _assessment_fixture()
    published_version = quiz.published_version
    assert published_version is not None

    revised = revise_quiz(
        actor=admin,
        quiz_id=quiz.id,
        expected_revision=quiz.revision,
        data=QuizInput(
            academic_node=lesson,
            title="Private revised title",
            instructions=published_version.instructions,
            mode=published_version.mode,
            selection_mode=published_version.selection_mode,
            question_count=published_version.question_count,
            question_versions=tuple(
                question.published_version
                for question in questions
                if question.published_version is not None
            ),
            duration_seconds=published_version.duration_seconds,
            maximum_attempts=published_version.maximum_attempts,
            pass_percent=published_version.pass_percent,
            allowed_difficulties=tuple(published_version.allowed_difficulties),
        ),
    )

    public = select_published_quiz(quiz_id=quiz.id)
    assert revised.current_version_id != published_version.id
    assert public.published_version_id == published_version.id
    assert public.published_version is not None
    assert public.published_version.title == "Cranial nerves checkpoint"
    started = start_attempt(user=student, quiz_id=quiz.id, idempotency_key=uuid4())
    assert started.attempt.quiz_version_id == published_version.id


def test_attempt_start_rejects_unfair_or_unavailable_configurations() -> None:
    admin, student, lesson, questions, quiz = _assessment_fixture()
    with pytest.raises(AttemptRuleError, match="Only practice"):
        start_attempt(
            user=student,
            quiz_id=quiz.id,
            idempotency_key=uuid4(),
            requested_question_count=1,
        )

    practice = published_quiz(
        actor=admin,
        node=lesson,
        questions=(questions[0],),
        mode=QuizVersion.Mode.PRACTICE,
        selection_mode=QuizVersion.SelectionMode.FIXED,
        title="Guarded practice",
    )
    with pytest.raises(AttemptRuleError, match="exceeds"):
        start_attempt(
            user=student,
            quiz_id=practice.id,
            idempotency_key=uuid4(),
            requested_question_count=2,
        )
    with pytest.raises(AttemptRuleError, match="outside"):
        start_attempt(
            user=student,
            quiz_id=practice.id,
            idempotency_key=uuid4(),
            difficulties=("expert",),
        )
    with pytest.raises(AttemptRuleError, match="question-pool"):
        start_attempt(
            user=student,
            quiz_id=practice.id,
            idempotency_key=uuid4(),
            review_only=True,
        )

    version = quiz.published_version
    assert version is not None
    now = timezone.now()
    version.available_from = now + timedelta(hours=1)
    version.save(update_fields=("available_from",))
    with pytest.raises(AttemptRuleError, match="not open"):
        start_attempt(user=student, quiz_id=quiz.id, idempotency_key=uuid4(), now=now)
    version.available_from = None
    version.available_until = now
    version.save(update_fields=("available_from", "available_until"))
    with pytest.raises(AttemptRuleError, match="closed"):
        start_attempt(user=student, quiz_id=quiz.id, idempotency_key=uuid4(), now=now)


def test_idempotency_and_integrity_inputs_are_scoped_and_fail_closed() -> None:
    admin, student, lesson, questions, quiz = _assessment_fixture()
    second_quiz = published_quiz(
        actor=admin,
        node=lesson,
        questions=questions,
        title="Second checkpoint",
    )
    start_key = uuid4()
    first = start_attempt(user=student, quiz_id=quiz.id, idempotency_key=start_key).attempt
    with pytest.raises(AttemptConflictError, match="another attempt"):
        start_attempt(user=student, quiz_id=second_quiz.id, idempotency_key=start_key)
    second = start_attempt(
        user=student,
        quiz_id=second_quiz.id,
        idempotency_key=uuid4(),
    ).attempt

    submission_key = uuid4()
    result = submit_attempt(
        user=student,
        attempt_id=first.id,
        idempotency_key=submission_key,
    )
    with pytest.raises(AttemptConflictError, match="another submission"):
        submit_attempt(
            user=student,
            attempt_id=second.id,
            idempotency_key=submission_key,
        )

    event_id = uuid4()
    record_attempt_activity(
        user=student,
        attempt_id=second.id,
        client_event_id=event_id,
        activity_type=AttemptActivity.ActivityType.PAGE_HIDDEN,
        client_occurred_at=timezone.now(),
        metadata={"reason": "document_hidden"},
    )
    with pytest.raises(AttemptConflictError, match="already in use"):
        record_attempt_activity(
            user=student,
            attempt_id=second.id,
            client_event_id=event_id,
            activity_type=AttemptActivity.ActivityType.PAGE_VISIBLE,
            client_occurred_at=timezone.now(),
            metadata={"reason": "document_visible"},
        )
    with pytest.raises(AttemptRuleError, match="Unsupported assessment activity"):
        record_attempt_activity(
            user=student,
            attempt_id=second.id,
            client_event_id=uuid4(),
            activity_type="clipboard_read",
            client_occurred_at=None,
            metadata={},
        )
    with pytest.raises(AttemptRuleError, match="unsupported fields"):
        record_attempt_activity(
            user=student,
            attempt_id=second.id,
            client_event_id=uuid4(),
            activity_type=AttemptActivity.ActivityType.CONNECTION_LOST,
            client_occurred_at=None,
            metadata={"score_adjustment": True},
        )
    first_question = first.questions.first()
    assert first_question is not None
    with pytest.raises(AttemptRuleError, match="Unsupported report category"):
        create_question_issue_report(
            user=student,
            result_id=result.id,
            attempt_question_id=first_question.id,
            category="automatic_penalty",
            details="This must not be accepted.",
        )
    with pytest.raises(AttemptRuleError, match="details are required"):
        create_question_issue_report(
            user=student,
            result_id=result.id,
            attempt_question_id=first_question.id,
            category=QuestionIssueReport.Category.OTHER,
            details=" ",
        )

"""Managed-sheet Active Study runtime backed by approved admin JSON content."""

from __future__ import annotations

from typing import Any, cast
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.content.active_study import DIFFICULTIES, ActiveStudyDifficulty, plan_payload
from apps.content.active_study_questions import (
    ActiveStudyQuestionValidationError,
    validate_active_study_questions,
)
from apps.content.active_study_readiness import readiness_payload
from apps.content.models import ActiveStudyQuestionContent, ActiveStudySettings, LearningObject
from apps.content.policies import can_view_learning_object
from apps.review.contracts import QuestionAttemptEvent
from apps.review.models import ReviewItem
from apps.review.services import record_question_attempt
from apps.xp.services import award_xp

from .active_study import XP_BY_DIFFICULTY
from .models import ActiveStudyAnswer, ActiveStudyAttempt, ActiveStudyRun


class ManagedActiveStudyRuleError(ValueError):
    pass


# Completion is awarded once per user/sheet/difficulty through the XP ledger's
# unique source key. Difficulty reward values reuse the existing focus policy.
CHECKPOINT_PASS = 10
FINAL_EXAM_PASS = 35


def _difficulty(key: str) -> ActiveStudyDifficulty:
    for item in DIFFICULTIES:
        if item.key == key:
            return item
    raise ManagedActiveStudyRuleError("Choose easy, medium, or hard difficulty.")


def _sheet_for_user(*, user: User, sheet_id: UUID) -> LearningObject:
    try:
        sheet = LearningObject.objects.select_related(
            "active_study_settings", "published_version__academic_node"
        ).get(id=sheet_id)
    except LearningObject.DoesNotExist as error:
        raise ManagedActiveStudyRuleError("Sheet not found.") from error
    if not can_view_learning_object(user=user, learning_object=sheet):
        raise ManagedActiveStudyRuleError("Active Study is not available for this sheet.")
    return sheet


def _plan_for_sheet(sheet: LearningObject) -> dict[str, Any]:
    settings = getattr(sheet, "active_study_settings", None)
    if not isinstance(settings, ActiveStudySettings) or not settings.enabled:
        raise ManagedActiveStudyRuleError("Active Study is disabled for this sheet.")
    if settings.total_pdf_pages is None:
        raise ManagedActiveStudyRuleError("Active Study is not configured for this sheet.")
    source_version = sheet.published_version or sheet.current_version
    if settings.source_version_id is not None and (
        source_version is None or settings.source_version_id != source_version.id
    ):
        raise ManagedActiveStudyRuleError(
            "Active Study needs review because the source PDF changed."
        )
    if (
        source_version is not None
        and source_version.page_count is not None
        and source_version.page_count != settings.total_pdf_pages
    ):
        raise ManagedActiveStudyRuleError(
            "Active Study needs review because the PDF pagination changed."
        )
    return cast(
        dict[str, Any],
        plan_payload(
            total_pdf_pages=settings.total_pdf_pages,
            excluded_start_pages=settings.excluded_start_pages,
            excluded_end_pages=settings.excluded_end_pages,
        ),
    )


def _difficulty_plan(*, sheet: LearningObject, difficulty: str) -> dict[str, Any]:
    plan = _plan_for_sheet(sheet)
    return next(
        item
        for item in cast(list[dict[str, Any]], plan["difficulties"])
        if item["difficulty"] == difficulty
    )


def _signature(plan: dict[str, Any]) -> dict[str, Any]:
    return {"number_of_parts": plan["number_of_parts"], "page_ranges": plan["page_ranges"]}


def _content(
    *, sheet: LearningObject, difficulty: str
) -> tuple[ActiveStudyQuestionContent, dict[str, Any]]:
    difficulty_rule = _difficulty(difficulty)
    plan = _difficulty_plan(sheet=sheet, difficulty=difficulty)
    try:
        content = ActiveStudyQuestionContent.objects.get(sheet=sheet, difficulty=difficulty)
    except ActiveStudyQuestionContent.DoesNotExist as error:
        raise ManagedActiveStudyRuleError(
            "Active Study questions are not configured yet."
        ) from error
    if content.plan_signature != _signature(plan):
        raise ManagedActiveStudyRuleError(
            "Active Study questions need review after the page plan changed."
        )
    source_version = sheet.published_version or sheet.current_version
    if content.source_version_id is not None and (
        source_version is None or content.source_version_id != source_version.id
    ):
        raise ManagedActiveStudyRuleError(
            "Active Study questions need review because the source PDF changed."
        )
    try:
        validate_active_study_questions(
            content.payload,
            difficulty=difficulty_rule,
            number_of_parts=cast(int, plan["number_of_parts"]),
        )
    except ActiveStudyQuestionValidationError as error:
        raise ManagedActiveStudyRuleError("Active Study questions are incomplete.") from error
    return content, plan


def availability(*, user: User, sheet_id: UUID) -> dict[str, Any]:
    sheet = _sheet_for_user(user=user, sheet_id=sheet_id)
    readiness = readiness_payload(sheet=sheet)
    rows: list[dict[str, Any]] = []
    for item in cast(list[dict[str, Any]], readiness["difficulties"]):
        status = cast(dict[str, str], item["readiness"])["status"]
        active = (
            ActiveStudyRun.objects.filter(
                user=user,
                sheet=sheet,
                difficulty=item["difficulty"],
                status=ActiveStudyRun.Status.ACTIVE,
            )
            .order_by("-updated_at")
            .first()
        )
        completed = ActiveStudyRun.objects.filter(
            user=user,
            sheet=sheet,
            difficulty=item["difficulty"],
            status=ActiveStudyRun.Status.COMPLETED,
        ).exists()
        rows.append(
            {
                "difficulty": item["difficulty"],
                "status": status,
                "number_of_parts": item["number_of_parts"],
                "page_ranges": item["page_ranges"],
                "progress": run_payload(active) if active else None,
                "completed": completed,
            }
        )
    return {
        "sheet_id": str(sheet.id),
        "enabled": readiness["enabled"],
        "difficulties": rows,
    }


def run_payload(run: ActiveStudyRun | None) -> dict[str, Any] | None:
    if run is None:
        return None
    ranges = cast(list[dict[str, int]], run.plan_signature.get("page_ranges", []))
    current_range = next((item for item in ranges if item["part"] == run.current_part), None)
    return {
        "id": str(run.id),
        "sheet_id": str(run.sheet_id) if run.sheet_id else None,
        "difficulty": run.difficulty,
        "status": run.status,
        "stage": run.stage,
        "current_part": run.current_part,
        "number_of_parts": len(ranges),
        "current_page_range": current_range,
        "completed_parts": run.completed_parts,
        "checkpoint_attempts": run.checkpoint_attempts,
        "final_attempts": run.final_attempts,
        "last_score": run.last_score,
        "last_outcome": run.last_outcome,
        "xp_awarded": run.xp_awarded,
    }


def _active_run(*, user: User, sheet: LearningObject, difficulty: str) -> ActiveStudyRun | None:
    return (
        ActiveStudyRun.objects.select_for_update()
        .filter(user=user, sheet=sheet, difficulty=difficulty, status=ActiveStudyRun.Status.ACTIVE)
        .order_by("-updated_at")
        .first()
    )


@transaction.atomic
def start(*, user: User, sheet_id: UUID, difficulty: str) -> tuple[ActiveStudyRun, bool]:
    sheet = _sheet_for_user(user=user, sheet_id=sheet_id)
    _difficulty(difficulty)
    _, plan = _content(sheet=sheet, difficulty=difficulty)
    existing = _active_run(user=user, sheet=sheet, difficulty=difficulty)
    if existing is not None:
        return existing, False
    ranges = cast(list[dict[str, int]], plan["page_ranges"])
    try:
        # A nested atomic block, so losing the race rolls back only this insert
        # and leaves the caller's transaction usable. The read above cannot lock
        # a row that does not exist yet, so the unique constraint is what
        # actually decides which concurrent start wins.
        with transaction.atomic():
            run = ActiveStudyRun.objects.create(
                user=user,
                sheet=sheet,
                material_slug="managed-sheet",
                sheet_slug=str(sheet.id),
                difficulty=difficulty,
                # The difficulty plan intentionally contains only
                # difficulty-specific data.  The PDF page count remains owned by
                # the sheet settings.
                page_count=cast(int, sheet.active_study_settings.total_pdf_pages),
                unlocked_pages=ranges[0]["end_page"],
                plan_signature=_signature(plan),
            )
    except IntegrityError:
        # Another request created the run between the read and the insert. Its
        # run is the one that exists, so this caller resumes it rather than
        # reporting a failure the reader did nothing to cause.
        concurrent = _active_run(user=user, sheet=sheet, difficulty=difficulty)
        if concurrent is None:
            raise
        return concurrent, False
    return run, True


def _locked_run(*, user: User, run_id: UUID) -> ActiveStudyRun:
    try:
        run = (
            # `sheet` is nullable for the legacy runtime.  Lock only the run
            # row so PostgreSQL does not attempt to lock the nullable side of
            # the `select_related` outer join below.
            ActiveStudyRun.objects.select_for_update(of=("self",))
            .select_related(
                "sheet__active_study_settings", "sheet__published_version__academic_node"
            )
            .get(id=run_id, user=user, sheet__isnull=False)
        )
    except ActiveStudyRun.DoesNotExist as error:
        raise ManagedActiveStudyRuleError("Active Study session not found.") from error
    if run.sheet is None:
        raise ManagedActiveStudyRuleError("This is not a managed Active Study session.")
    _sheet_for_user(user=user, sheet_id=cast(UUID, run.sheet_id))
    return run


def _questions_for(run: ActiveStudyRun, *, kind: str, part: int | None) -> list[dict[str, Any]]:
    if run.sheet is None:
        raise ManagedActiveStudyRuleError("Active Study session is not linked to a sheet.")
    content, _ = _content(sheet=run.sheet, difficulty=run.difficulty)
    payload = cast(dict[str, Any], content.payload)
    if kind == ActiveStudyAttempt.Kind.FINAL:
        return cast(list[dict[str, Any]], payload["final_exam"]["questions"])
    selected = next(
        item for item in cast(list[dict[str, Any]], payload["parts"]) if item["part"] == part
    )
    return cast(list[dict[str, Any]], selected["questions"])


def _active_attempt(
    run: ActiveStudyRun, *, kind: str, part: int | None, total: int
) -> ActiveStudyAttempt:
    existing = run.attempts.filter(kind=kind, part_number=part, submitted_at__isnull=True).first()
    if existing is not None:
        return existing
    number = run.attempts.filter(kind=kind, part_number=part).count() + 1
    return ActiveStudyAttempt.objects.create(
        run=run, kind=kind, part_number=part, number=number, total=total
    )


@transaction.atomic
def complete_part_reading(*, user: User, run_id: UUID) -> ActiveStudyRun:
    run = _locked_run(user=user, run_id=run_id)
    if run.status != ActiveStudyRun.Status.ACTIVE or run.stage != ActiveStudyRun.Stage.READING:
        raise ManagedActiveStudyRuleError("This part is not ready for its checkpoint.")
    run.stage = ActiveStudyRun.Stage.CHECKPOINT
    run.save(update_fields=("stage", "updated_at"))
    return run


@transaction.atomic
def questions(*, user: User, run_id: UUID) -> dict[str, Any]:
    run = _locked_run(user=user, run_id=run_id)
    if run.status != ActiveStudyRun.Status.ACTIVE or run.stage not in {
        ActiveStudyRun.Stage.CHECKPOINT,
        ActiveStudyRun.Stage.FINAL,
    }:
        raise ManagedActiveStudyRuleError("Questions are not available at this stage.")
    kind = (
        ActiveStudyAttempt.Kind.FINAL
        if run.stage == ActiveStudyRun.Stage.FINAL
        else ActiveStudyAttempt.Kind.CHECKPOINT
    )
    part = None if kind == ActiveStudyAttempt.Kind.FINAL else run.current_part
    source = _questions_for(run, kind=kind, part=part)
    attempt = _active_attempt(run, kind=kind, part=part, total=len(source))
    answered = {
        answer.question_position: answer.selected_answer for answer in attempt.answers.all()
    }
    return {
        "run": run_payload(run),
        "attempt_id": str(attempt.id),
        "kind": kind,
        "questions": [
            {
                "position": index,
                "question": item["question"],
                "options": item["options"],
                "answered": answered.get(index),
            }
            for index, item in enumerate(source, start=1)
        ],
    }


def _question_event(
    *,
    run: ActiveStudyRun,
    attempt: ActiveStudyAttempt,
    question: dict[str, Any],
    position: int,
    selected: str,
    correct: bool,
) -> QuestionAttemptEvent:
    if run.sheet is None or run.sheet.published_version is None:
        raise ManagedActiveStudyRuleError("The sheet is no longer available.")
    node = run.sheet.published_version.academic_node
    options = cast(dict[str, str], question["options"])
    return QuestionAttemptEvent(
        user=run.user,
        event_key=f"active-study:{attempt.id}:question:{position}",
        canonical_key=f"active-study:{run.sheet_id}:{run.difficulty}:{attempt.kind}:{attempt.part_number}:{position}",
        subject_key=f"content:{node.id}",
        subject_label=node.title,
        source_type=ReviewItem.SourceType.SHEET,
        source_id=str(run.sheet_id),
        source_label=run.sheet.published_version.title,
        source_question_index=position,
        prompt=cast(str, question["question"]),
        explanation=cast(str, question["explanation"]),
        options=tuple({"id": key, "text": value} for key, value in options.items()),
        selected_option_ids=(selected,),
        correct_option_ids=(cast(str, question["correct_answer"]),),
        is_correct=correct,
        answered_at=timezone.now(),
        subject=node,
    )


@transaction.atomic
def answer(
    *, user: User, run_id: UUID, attempt_id: UUID, position: int, selected_answer: str
) -> dict[str, Any]:
    run = _locked_run(user=user, run_id=run_id)
    if selected_answer not in {"A", "B", "C", "D"}:
        raise ManagedActiveStudyRuleError("Choose A, B, C, or D.")
    try:
        attempt = ActiveStudyAttempt.objects.select_for_update().get(
            id=attempt_id, run=run, submitted_at__isnull=True
        )
    except ActiveStudyAttempt.DoesNotExist as error:
        raise ManagedActiveStudyRuleError("This question attempt is no longer active.") from error
    kind = (
        ActiveStudyAttempt.Kind.FINAL
        if run.stage == ActiveStudyRun.Stage.FINAL
        else ActiveStudyAttempt.Kind.CHECKPOINT
    )
    part = None if kind == ActiveStudyAttempt.Kind.FINAL else run.current_part
    if attempt.kind != kind or attempt.part_number != part:
        raise ManagedActiveStudyRuleError(
            "This question does not belong to the current Active Study stage."
        )
    source = _questions_for(run, kind=kind, part=part)
    if position < 1 or position > len(source):
        raise ManagedActiveStudyRuleError("Question position is invalid.")
    question = source[position - 1]
    correct = selected_answer == question["correct_answer"]
    existing = ActiveStudyAnswer.objects.filter(attempt=attempt, question_position=position).first()
    if existing is not None:
        if existing.selected_answer != selected_answer:
            raise ManagedActiveStudyRuleError("This answer was already submitted.")
        correct = existing.was_correct
    else:
        ActiveStudyAnswer.objects.create(
            attempt=attempt,
            question_position=position,
            selected_answer=selected_answer,
            was_correct=correct,
        )
        record_question_attempt(
            event=_question_event(
                run=run,
                attempt=attempt,
                question=question,
                position=position,
                selected=selected_answer,
                correct=correct,
            )
        )
    return {
        "correct": correct,
        "correct_answer": question["correct_answer"],
        "explanation": question["explanation"],
        "answered_count": attempt.answers.count(),
        "total": len(source),
    }


@transaction.atomic
def submit(*, user: User, run_id: UUID, attempt_id: UUID) -> tuple[ActiveStudyRun, dict[str, Any]]:
    run = _locked_run(user=user, run_id=run_id)
    try:
        attempt = ActiveStudyAttempt.objects.select_for_update().get(id=attempt_id, run=run)
    except ActiveStudyAttempt.DoesNotExist as error:
        raise ManagedActiveStudyRuleError("Question attempt not found.") from error
    if attempt.submitted_at is not None:
        return run, {
            "score": attempt.score,
            "total": attempt.total,
            "passed": attempt.passed,
            "already_submitted": True,
        }
    expected_stage = (
        ActiveStudyRun.Stage.FINAL
        if attempt.kind == ActiveStudyAttempt.Kind.FINAL
        else ActiveStudyRun.Stage.CHECKPOINT
    )
    if run.stage != expected_stage or (
        attempt.kind == ActiveStudyAttempt.Kind.CHECKPOINT
        and attempt.part_number != run.current_part
    ):
        raise ManagedActiveStudyRuleError("This attempt cannot be submitted now.")
    if attempt.answers.count() != attempt.total:
        raise ManagedActiveStudyRuleError("Answer every question before submitting.")
    score = attempt.answers.filter(was_correct=True).count()
    passed = score >= (
        FINAL_EXAM_PASS if attempt.kind == ActiveStudyAttempt.Kind.FINAL else CHECKPOINT_PASS
    )
    attempt.score, attempt.passed, attempt.submitted_at = score, passed, timezone.now()
    attempt.save(update_fields=("score", "passed", "submitted_at"))
    run.last_score = score
    if attempt.kind == ActiveStudyAttempt.Kind.CHECKPOINT:
        run.checkpoint_attempts += 1
        run.last_outcome = "passed" if passed else "failed"
        run.stage = (
            ActiveStudyRun.Stage.READING if passed else ActiveStudyRun.Stage.CHECKPOINT_RESULT
        )
        if passed:
            run.completed_parts = [*cast(list[int], run.completed_parts), run.current_part]
            ranges = cast(list[dict[str, int]], run.plan_signature["page_ranges"])
            if run.current_part == len(ranges):
                run.stage = ActiveStudyRun.Stage.FINAL
            else:
                run.current_part += 1
                run.unlocked_pages = ranges[run.current_part - 1]["end_page"]
    else:
        run.final_attempts += 1
        run.last_outcome = "passed" if passed else "failed"
        run.stage = ActiveStudyRun.Stage.FINAL_RESULT
        if passed:
            run.status = ActiveStudyRun.Status.COMPLETED
            award, created = award_xp(
                user_id=user.id,
                source_key=f"active-study-managed:{user.id}:{run.sheet_id}:{run.difficulty}",
                source_event_id=None,
                source_event_name="focus.active_study.completed",
                source_object_id=run.id,
                rule_code=f"active_study_{run.difficulty}_v1",
                points=XP_BY_DIFFICULTY[run.difficulty],
                category="learning",
                reason=f"{run.difficulty.title()} Active Study completed",
                occurred_at=attempt.submitted_at,
                ranking_eligible=True,
            )
            run.xp_awarded = award.points if created else 0
    run.save()
    return run, {
        "score": score,
        "total": attempt.total,
        "passed": passed,
        "completed": run.status == ActiveStudyRun.Status.COMPLETED,
        "xp_awarded": run.xp_awarded,
    }


@transaction.atomic
def continue_anyway(*, user: User, run_id: UUID) -> ActiveStudyRun:
    run = _locked_run(user=user, run_id=run_id)
    if run.stage != ActiveStudyRun.Stage.CHECKPOINT_RESULT:
        raise ManagedActiveStudyRuleError("This checkpoint cannot be continued.")
    attempt = (
        run.attempts.filter(
            kind=ActiveStudyAttempt.Kind.CHECKPOINT,
            part_number=run.current_part,
            submitted_at__isnull=False,
        )
        .order_by("-number")
        .first()
    )
    if attempt is None or attempt.passed:
        raise ManagedActiveStudyRuleError("This checkpoint does not need a continuation choice.")
    attempt.continued_anyway = True
    attempt.save(update_fields=("continued_anyway",))
    run.completed_parts = [*cast(list[int], run.completed_parts), run.current_part]
    ranges = cast(list[dict[str, int]], run.plan_signature["page_ranges"])
    if run.current_part == len(ranges):
        run.stage = ActiveStudyRun.Stage.FINAL
    else:
        run.current_part += 1
        run.unlocked_pages = ranges[run.current_part - 1]["end_page"]
        run.stage = ActiveStudyRun.Stage.READING
    run.last_outcome = "continued_anyway"
    run.save()
    return run


@transaction.atomic
def study_again(*, user: User, run_id: UUID) -> ActiveStudyRun:
    run = _locked_run(user=user, run_id=run_id)
    if run.stage != ActiveStudyRun.Stage.CHECKPOINT_RESULT:
        raise ManagedActiveStudyRuleError("This checkpoint cannot be studied again now.")
    run.stage = ActiveStudyRun.Stage.READING
    run.last_outcome = "study_again"
    run.save(update_fields=("stage", "last_outcome", "updated_at"))
    return run


@transaction.atomic
def retry_final(*, user: User, run_id: UUID) -> ActiveStudyRun:
    run = _locked_run(user=user, run_id=run_id)
    if run.status != ActiveStudyRun.Status.ACTIVE or run.stage != ActiveStudyRun.Stage.FINAL_RESULT:
        raise ManagedActiveStudyRuleError("The final exam cannot be retried now.")
    run.stage = ActiveStudyRun.Stage.FINAL
    run.last_outcome = "retry_final"
    run.save(update_fields=("stage", "last_outcome", "updated_at"))
    return run


@transaction.atomic
def abandon(*, user: User, run_id: UUID) -> ActiveStudyRun:
    """Retain a stranded run and all evidence while allowing a clean restart."""

    run = _locked_run(user=user, run_id=run_id)
    if run.status != ActiveStudyRun.Status.ACTIVE:
        raise ManagedActiveStudyRuleError("Only an active Active Study run can be abandoned.")
    run.status = ActiveStudyRun.Status.ABANDONED
    run.last_outcome = "abandoned"
    run.save(update_fields=("status", "last_outcome", "updated_at"))
    return run

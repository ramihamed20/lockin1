"""Managed-sheet Active Study runtime backed by approved admin JSON content."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import replace
from math import ceil
from typing import Any, cast
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.content.active_study import DIFFICULTIES, ActiveStudyDifficulty
from apps.content.active_study_questions import (
    ActiveStudyQuestionValidationError,
    validate_active_study_questions,
)
from apps.content.active_study_readiness import (
    edition_plan,
    edition_source_changed,
    effective_settings,
    lockin_plan_inputs,
    readiness_payload,
    resolve_total_pdf_pages,
    settings_for,
    source_version_for,
)
from apps.content.editions import UNIVERSITY, normalize_edition
from apps.content.models import ActiveStudyQuestionContent, LearningObject
from apps.content.page_question_bank import custom_page_ranges, select_page_questions
from apps.content.policies import can_view_learning_object
from apps.review.contracts import QuestionAttemptEvent
from apps.review.models import ReviewItem
from apps.review.services import record_question_attempt
from apps.xp.services import award_xp
from platform_core.events import publish_after_commit

from .active_study import XP_BY_DIFFICULTY
from .events import ActiveStudyExamPassed
from .models import ActiveStudyAnswer, ActiveStudyAttempt, ActiveStudyRun
from .question_identity import question_key


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
        sheet = (
            LearningObject.objects.select_related(
                "published_version__academic_node", "current_version"
            )
            .prefetch_related(
                "active_study_settings_set", "published_version__assets__managed_file"
            )
            .get(id=sheet_id)
        )
    except LearningObject.DoesNotExist as error:
        raise ManagedActiveStudyRuleError("Sheet not found.") from error
    if not can_view_learning_object(user=user, learning_object=sheet):
        raise ManagedActiveStudyRuleError("Active Study is not available for this sheet.")
    return sheet


def _plan_for_sheet(sheet: LearningObject, *, edition: str = UNIVERSITY) -> dict[str, Any]:
    """The page plan a student is actually reading against.

    Both editions plan through the content app's own planner, so a Lock-in run
    and a university run differ only in the page boundaries of the PDF they were
    built from.
    """

    edition = normalize_edition(edition)
    effective = effective_settings(sheet=sheet, edition=edition)
    if not effective.enabled:
        raise ManagedActiveStudyRuleError("Active Study is disabled for this sheet.")
    settings = effective.own
    if settings is not None and settings.total_pdf_pages is None:
        raise ManagedActiveStudyRuleError("Active Study is not configured for this sheet.")
    source_version = source_version_for(sheet)
    if settings is not None and edition_source_changed(
        recorded_version_id=settings.source_version_id,
        current_version=source_version,
        edition=edition,
    ):
        raise ManagedActiveStudyRuleError(
            "Active Study needs review because the source PDF changed."
        )
    pinned: dict[str, Any] = {}
    if edition != UNIVERSITY:
        inputs, _ = lockin_plan_inputs(sheet=sheet, source_version=source_version)
        if inputs is None:
            raise ManagedActiveStudyRuleError("Active Study is not configured for this sheet.")
        pinned = inputs
    plan, error = edition_plan(
        sheet=sheet,
        edition=edition,
        source_version=source_version,
        **pinned,
    )
    if plan is None:
        raise ManagedActiveStudyRuleError(error or "Active Study is not configured for this sheet.")
    return cast(dict[str, Any], plan)


def _difficulty_plan(
    *, sheet: LearningObject, difficulty: str, edition: str = UNIVERSITY
) -> dict[str, Any]:
    plan = _plan_for_sheet(sheet, edition=edition)
    return next(
        item
        for item in cast(list[dict[str, Any]], plan["difficulties"])
        if item["difficulty"] == difficulty
    )


def _signature(plan: dict[str, Any]) -> dict[str, Any]:
    return {"number_of_parts": plan["number_of_parts"], "page_ranges": plan["page_ranges"]}


def _synchronize_run_to_plan(
    *, run: ActiveStudyRun, plan: dict[str, Any], total_pdf_pages: int
) -> ActiveStudyRun:
    """Refresh persisted run metadata without touching learner progress.

    A run can outlive an Admin settings save.  Its progress belongs to the
    learner, but its page ranges are derived configuration and must follow the
    current saved plan whenever the learner resumes it.
    """

    ranges = cast(list[dict[str, int]], plan["page_ranges"])
    if run.current_part > len(ranges):
        raise ManagedActiveStudyRuleError(
            "This Active Study session cannot be mapped to the current page plan. "
            "Review the saved progress before resuming."
        )
    signature = {**run.plan_signature, **_signature(plan)}
    updates: list[str] = []
    if run.plan_signature != signature:
        run.plan_signature = signature
        updates.append("plan_signature")
    if run.page_count != total_pdf_pages:
        run.page_count = total_pdf_pages
        updates.append("page_count")
    unlocked_pages = ranges[run.current_part - 1]["end_page"]
    if run.unlocked_pages != unlocked_pages:
        run.unlocked_pages = unlocked_pages
        updates.append("unlocked_pages")
    if updates:
        run.save(update_fields=[*updates, "updated_at"])
    return run


def _content(
    *, sheet: LearningObject, difficulty: str, edition: str = UNIVERSITY
) -> tuple[ActiveStudyQuestionContent, dict[str, Any]]:
    """The sheet's one question bank, with the plan of the chosen edition.

    There is a single bank per sheet and difficulty; the edition only decides
    which pages each part covers.
    """

    edition = normalize_edition(edition)
    difficulty_rule = _difficulty(difficulty)
    plan = _difficulty_plan(sheet=sheet, difficulty=difficulty, edition=edition)
    difficulty_rule = replace(
        difficulty_rule,
        questions_per_checkpoint=cast(int, plan["questions_per_checkpoint"]),
        final_exam_questions=cast(int, plan["final_exam_questions"]),
    )
    try:
        content = ActiveStudyQuestionContent.objects.get(sheet=sheet, difficulty=difficulty)
    except ActiveStudyQuestionContent.DoesNotExist as error:
        raise ManagedActiveStudyRuleError(
            "Active Study questions are not configured yet."
        ) from error
    # Questions are signed against the university plan, which is the structure
    # every edition inherits.
    imported_plan = plan
    if edition != UNIVERSITY:
        university_plan, _ = edition_plan(sheet=sheet, edition=UNIVERSITY)
        imported_plan = next(
            (
                item
                for item in cast(
                    list[dict[str, Any]], (university_plan or {}).get("difficulties", [])
                )
                if item["difficulty"] == difficulty
            ),
            {"number_of_parts": 0, "page_ranges": []},
        )
    if content.plan_signature != _signature(imported_plan):
        raise ManagedActiveStudyRuleError(
            "Active Study questions need review after the page plan changed."
        )
    # Only replacing the University PDF the questions describe makes them stale.
    if edition_source_changed(
        recorded_version_id=content.source_version_id,
        current_version=source_version_for(sheet),
        edition=UNIVERSITY,
    ):
        raise ManagedActiveStudyRuleError(
            "Active Study questions need review because the source PDF changed."
        )
    try:
        validate_active_study_questions(
            content.payload,
            difficulty=difficulty_rule,
            number_of_parts=cast(int, plan["number_of_parts"]),
            page_ranges=cast(list[dict[str, int]], imported_plan["page_ranges"]),
            question_format=str(imported_plan.get("question_format", "parts")),
        )
    except ActiveStudyQuestionValidationError as error:
        raise ManagedActiveStudyRuleError("Active Study questions are incomplete.") from error
    return content, plan


def _runtime_plan(
    *,
    sheet: LearningObject,
    content: ActiveStudyQuestionContent,
    plan: dict[str, Any],
    study_mode: str,
    pages_per_checkpoint: int | None,
    questions_per_checkpoint: int | None,
    edition: str,
) -> dict[str, Any]:
    if study_mode not in {"standard", "custom"}:
        raise ManagedActiveStudyRuleError("Choose standard or custom Active Study.")
    if study_mode == "standard":
        if pages_per_checkpoint is not None or questions_per_checkpoint is not None:
            raise ManagedActiveStudyRuleError("Custom settings require custom Active Study.")
        return plan
    if not sheet.active_study_page_bank_enabled or "pages" not in content.payload:
        raise ManagedActiveStudyRuleError(
            "Customization is available only for new page-based sheets."
        )
    if (
        isinstance(questions_per_checkpoint, bool)
        or not isinstance(questions_per_checkpoint, int)
        or not 1 <= questions_per_checkpoint <= 20
    ):
        raise ManagedActiveStudyRuleError("Choose between 1 and 20 questions.")
    ranges = plan["page_ranges"]
    source_ranges = content.plan_signature["page_ranges"]
    start, end = ranges[0]["start_page"], ranges[-1]["end_page"]
    if end - start != source_ranges[-1]["end_page"] - source_ranges[0]["start_page"]:
        raise ManagedActiveStudyRuleError(
            "This edition needs matching study pages before customization can be used."
        )
    if pages_per_checkpoint is None:
        raise ManagedActiveStudyRuleError("Choose a page count for custom Active Study.")
    try:
        ranges = custom_page_ranges(start, end, pages_per_checkpoint)
    except ValueError as error:
        raise ManagedActiveStudyRuleError(str(error)) from error
    return {
        **plan,
        "page_ranges": ranges,
        "number_of_parts": len(ranges),
        "pages_per_checkpoint": pages_per_checkpoint,
        "questions_per_checkpoint": questions_per_checkpoint,
        "source_page_offset": source_ranges[0]["start_page"] - start,
    }


def availability(*, user: User, sheet_id: UUID, edition: str = UNIVERSITY) -> dict[str, Any]:
    edition = normalize_edition(edition)
    sheet = _sheet_for_user(user=user, sheet_id=sheet_id)
    readiness = readiness_payload(sheet=sheet, edition=edition)
    rows: list[dict[str, Any]] = []
    for item in cast(list[dict[str, Any]], readiness["difficulties"]):
        status = cast(dict[str, str], item["readiness"])["status"]
        active = (
            ActiveStudyRun.objects.filter(
                user=user,
                sheet=sheet,
                difficulty=item["difficulty"],
                edition=edition,
                status=ActiveStudyRun.Status.ACTIVE,
                study_mode="standard",
            )
            .order_by("-updated_at")
            .first()
        )
        completed = ActiveStudyRun.objects.filter(
            user=user,
            sheet=sheet,
            difficulty=item["difficulty"],
            edition=edition,
            status=ActiveStudyRun.Status.COMPLETED,
            study_mode="standard",
        ).exists()
        custom = ActiveStudyRun.objects.filter(
            user=user,
            sheet=sheet,
            difficulty=item["difficulty"],
            edition=edition,
            study_mode="custom",
            status="active",
        ).first()
        custom_supported = bool(
            sheet.active_study_page_bank_enabled
            and status == "ready"
            and (edition == UNIVERSITY or readiness["study_pages_match_university"])
        )
        rows.append(
            {
                "difficulty": item["difficulty"],
                "status": status,
                "number_of_parts": item["number_of_parts"],
                "page_ranges": item["page_ranges"],
                "progress": run_payload(active) if active else None,
                "custom_progress": run_payload(custom),
                "customization_available": custom_supported,
                "max_questions": 20,
                "eligible_study_pages": readiness["eligible_study_pages"],
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
        "study_mode": run.study_mode,
        "pages_per_checkpoint": run.plan_signature.get("pages_per_checkpoint"),
        "questions_per_checkpoint": run.plan_signature.get("questions_per_checkpoint", 15),
        "page_ranges": ranges,
        "content_revision": run.plan_signature.get("content_revision"),
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


def _active_run(
    *,
    user: User,
    sheet: LearningObject,
    difficulty: str,
    edition: str = UNIVERSITY,
    study_mode: str = "standard",
) -> ActiveStudyRun | None:
    return (
        ActiveStudyRun.objects.select_for_update()
        .filter(
            user=user,
            sheet=sheet,
            difficulty=difficulty,
            edition=edition,
            study_mode=study_mode,
            status=ActiveStudyRun.Status.ACTIVE,
        )
        .order_by("-updated_at")
        .first()
    )


@transaction.atomic
def start(
    *,
    user: User,
    sheet_id: UUID,
    difficulty: str,
    edition: str = UNIVERSITY,
    study_mode: str = "standard",
    pages_per_checkpoint: int | None = None,
    questions_per_checkpoint: int | None = None,
    replace_existing: bool = False,
) -> tuple[ActiveStudyRun, bool]:
    edition = normalize_edition(edition)
    sheet = _sheet_for_user(user=user, sheet_id=sheet_id)
    _difficulty(difficulty)
    content, plan = _content(sheet=sheet, difficulty=difficulty, edition=edition)
    plan = _runtime_plan(
        sheet=sheet,
        content=content,
        plan=plan,
        study_mode=study_mode,
        pages_per_checkpoint=pages_per_checkpoint,
        questions_per_checkpoint=questions_per_checkpoint,
        edition=edition,
    )
    # The edition's own configured count, or its PDF's count when a Lock-in
    # edition is following the University Sheet's settings.
    plan_total_pages, _ = resolve_total_pdf_pages(
        settings=settings_for(sheet=sheet, edition=edition),
        source_version=source_version_for(sheet),
        edition=edition,
    )
    if plan_total_pages is None:
        raise ManagedActiveStudyRuleError("Active Study is not configured for this sheet.")
    existing = _active_run(
        user=user, sheet=sheet, difficulty=difficulty, edition=edition, study_mode=study_mode
    )
    if existing is not None and replace_existing and study_mode == "custom":
        abandon(user=user, run_id=existing.id)
        existing = None
    if existing is not None:
        if study_mode == "custom" and any(
            existing.plan_signature.get(key) != plan.get(key)
            for key in ("pages_per_checkpoint", "questions_per_checkpoint")
        ):
            raise ManagedActiveStudyRuleError(
                "Resume or restart your saved custom session before changing its settings."
            )
        if (
            "pages" in content.payload
            and existing.plan_signature.get("content_revision") != content.revision
        ):
            raise ManagedActiveStudyRuleError(
                "Questions changed. Restart this session to use the updated bank."
            )
        if study_mode == "custom":
            if existing.plan_signature["page_ranges"] != plan["page_ranges"]:
                raise ManagedActiveStudyRuleError(
                    "Study pages changed. Restart this custom session."
                )
            return existing, False
        return _synchronize_run_to_plan(
            run=existing, plan=plan, total_pdf_pages=plan_total_pages
        ), False
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
                edition=edition,
                difficulty=difficulty,
                # The difficulty plan intentionally contains only
                # difficulty-specific data.  The PDF page count remains owned by
                # the sheet settings.
                page_count=plan_total_pages,
                unlocked_pages=ranges[0]["end_page"],
                study_mode=study_mode,
                plan_signature={
                    **_signature(plan),
                    **(
                        {
                            "content_revision": content.revision,
                            "questions_per_checkpoint": plan["questions_per_checkpoint"],
                        }
                        if "pages" in content.payload
                        else {}
                    ),
                    **(
                        {
                            key: plan[key]
                            for key in (
                                "pages_per_checkpoint",
                                "questions_per_checkpoint",
                                "source_page_offset",
                            )
                        }
                        if study_mode == "custom"
                        else {}
                    ),
                },
            )
    except IntegrityError:
        # Another request created the run between the read and the insert. Its
        # run is the one that exists, so this caller resumes it rather than
        # reporting a failure the reader did nothing to cause.
        concurrent = _active_run(
            user=user, sheet=sheet, difficulty=difficulty, edition=edition, study_mode=study_mode
        )
        if concurrent is None:
            raise
        if study_mode == "custom" and any(
            concurrent.plan_signature.get(key) != plan.get(key)
            for key in ("pages_per_checkpoint", "questions_per_checkpoint")
        ):
            raise ManagedActiveStudyRuleError(
                "Another custom session started with different settings. Reload and resume it."
            ) from None
        return concurrent, False
    return run, True


def _locked_run(*, user: User, run_id: UUID) -> ActiveStudyRun:
    try:
        run = (
            # `sheet` is nullable for the legacy runtime.  Lock only the run
            # row so PostgreSQL does not attempt to lock the nullable side of
            # the `select_related` outer join below.
            ActiveStudyRun.objects.select_for_update(of=("self",))
            .select_related("sheet__published_version__academic_node")
            .prefetch_related(
                "sheet__active_study_settings_set",
                "sheet__published_version__assets__managed_file",
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
    content, plan = _content(sheet=run.sheet, difficulty=run.difficulty, edition=run.edition)
    if (
        "pages" in content.payload
        and run.plan_signature.get("content_revision") != content.revision
    ):
        raise ManagedActiveStudyRuleError("Questions changed. Restart this session before testing.")
    payload = cast(dict[str, Any], content.payload)
    if kind == ActiveStudyAttempt.Kind.FINAL:
        return cast(list[dict[str, Any]], payload["final_exam"]["questions"])
    if "pages" in payload:
        if part is None or not 1 <= part <= len(run.plan_signature["page_ranges"]):
            raise ManagedActiveStudyRuleError("Checkpoint page group is invalid.")
        if run.study_mode == "custom":
            source_range = run.plan_signature["page_ranges"][part - 1]
            offset = run.plan_signature["source_page_offset"]
        else:
            source_range = content.plan_signature["page_ranges"][part - 1]
            offset = 0
        try:
            return select_page_questions(
                payload,
                source_range["start_page"] + offset,
                source_range["end_page"] + offset,
                run.plan_signature.get(
                    "questions_per_checkpoint", plan["questions_per_checkpoint"]
                ),
            )
        except ValueError as error:
            raise ManagedActiveStudyRuleError(str(error)) from error
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
                "question_type": item.get("type", "mcq"),
                "options": _display_options(item),
                "answered": answered.get(index),
            }
            for index, item in enumerate(source, start=1)
        ],
    }


# Every answer key a question can offer: A-D for multiple choice, T/F for
# true/false. Each question still accepts only its own keys.
ANSWER_KEYS = ("A", "B", "C", "D", "T", "F")


def _display_options(question: dict[str, Any]) -> dict[str, str]:
    if question.get("type") == "true_false":
        return {"T": "True", "F": "False"}
    return cast(dict[str, str], question["options"])


def _correct_answer(question: dict[str, Any]) -> str:
    if question.get("type") == "true_false":
        return "T" if question["correct_answer"] is True else "F"
    return cast(str, question["correct_answer"])


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
    options = _display_options(question)
    return QuestionAttemptEvent(
        user=run.user,
        event_key=f"active-study:{attempt.id}:question:{position}",
        canonical_key=question_key(
            run, attempt.kind, attempt.part_number, position, question.get("source_key")
        ),
        subject_key=f"content:{node.id}",
        subject_label=node.title,
        source_type=ReviewItem.SourceType.ACTIVE_STUDY,
        source_id=str(run.sheet_id),
        source_label=run.sheet.published_version.title,
        source_question_index=position,
        prompt=cast(str, question["question"]),
        explanation=cast(str, question["explanation"]),
        options=tuple({"id": key, "text": value} for key, value in options.items()),
        selected_option_ids=(selected,),
        correct_option_ids=(_correct_answer(question),),
        is_correct=correct,
        answered_at=timezone.now(),
        subject=node,
    )


def _record_answer(
    *,
    run: ActiveStudyRun,
    attempt: ActiveStudyAttempt,
    source: list[dict[str, Any]],
    position: int,
    selected_answer: str,
) -> dict[str, Any]:
    """Store one answer of an open attempt and put a miss in Review, once."""

    if position < 1 or position > len(source):
        raise ManagedActiveStudyRuleError("Question position is invalid.")
    question = source[position - 1]
    if selected_answer not in _display_options(question):
        raise ManagedActiveStudyRuleError("Choose an answer for this question.")
    correct = selected_answer == _correct_answer(question)
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
        "position": position,
        "correct": correct,
        "correct_answer": _correct_answer(question),
        "explanation": question["explanation"],
    }


@transaction.atomic
def answer(
    *, user: User, run_id: UUID, attempt_id: UUID, position: int, selected_answer: str
) -> dict[str, Any]:
    run = _locked_run(user=user, run_id=run_id)
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
    checked = _record_answer(
        run=run,
        attempt=attempt,
        source=source,
        position=position,
        selected_answer=selected_answer,
    )
    return {
        "correct": checked["correct"],
        "correct_answer": checked["correct_answer"],
        "explanation": checked["explanation"],
        "answered_count": attempt.answers.count(),
        "total": len(source),
    }


def _review_of(attempt: ActiveStudyAttempt, source: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each question's verdict, from the answers the server holds."""

    held = {item.question_position: item for item in attempt.answers.all()}
    return [
        {
            "position": position,
            "correct": held[position].was_correct,
            "correct_answer": _correct_answer(question),
            "explanation": question["explanation"],
        }
        for position, question in enumerate(source, start=1)
        if position in held
    ]


@transaction.atomic
def submit(
    *,
    user: User,
    run_id: UUID,
    attempt_id: UUID,
    answers: Sequence[Mapping[str, Any]] = (),
) -> tuple[ActiveStudyRun, dict[str, Any]]:
    """Grade an attempt, optionally recording its answers in the same request.

    ``answers`` is every remaining answer of the open attempt. Taking them here
    saves a round trip per question: the content is read once, and the grading
    and the Review entries commit together or not at all.
    """

    run = _locked_run(user=user, run_id=run_id)
    try:
        attempt = ActiveStudyAttempt.objects.select_for_update().get(id=attempt_id, run=run)
    except ActiveStudyAttempt.DoesNotExist as error:
        raise ManagedActiveStudyRuleError("Question attempt not found.") from error
    if attempt.submitted_at is not None:
        done_source = _questions_for(run, kind=attempt.kind, part=attempt.part_number)
        return run, {
            "score": attempt.score,
            "total": attempt.total,
            "passed": attempt.passed,
            "already_submitted": True,
            "review": _review_of(attempt, done_source),
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
    source = _questions_for(run, kind=attempt.kind, part=attempt.part_number)
    for item in answers:
        _record_answer(
            run=run,
            attempt=attempt,
            source=source,
            position=int(item["position"]),
            selected_answer=str(item["selected_answer"]),
        )
    if attempt.answers.count() != attempt.total:
        raise ManagedActiveStudyRuleError("Answer every question before submitting.")
    score = attempt.answers.filter(was_correct=True).count()
    passed = score >= (
        ceil(attempt.total * 7 / 10)
        if attempt.kind == ActiveStudyAttempt.Kind.FINAL
        else ceil(attempt.total * 2 / 3)
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
    if passed:
        # Published rather than recorded here: the streak, XP and achievement
        # ledgers are fed through one integration boundary, so this stays the
        # fact ("an exam was passed") and not a decision about what it earns.
        publish_after_commit(
            ActiveStudyExamPassed(
                run_id=run.id,
                attempt_id=attempt.id,
                user_id=user.id,
                sheet_id=cast(UUID, run.sheet_id),
                difficulty=run.difficulty,
                kind=attempt.kind,
                score=score,
                total=attempt.total,
                run_completed=run.status == ActiveStudyRun.Status.COMPLETED,
                occurred_at=attempt.submitted_at,
                actor_id=user.id,
            )
        )
    return run, {
        "score": score,
        "total": attempt.total,
        "passed": passed,
        "completed": run.status == ActiveStudyRun.Status.COMPLETED,
        "xp_awarded": run.xp_awarded,
        "review": _review_of(attempt, source),
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
def discard_open_attempt(*, user: User, run_id: UUID) -> ActiveStudyRun:
    """Throw away the unsubmitted checkpoint or final attempt of the current stage.

    Only that attempt and its answers go: submitted attempts, completed parts,
    the run's stage and the Review Bank events already recorded all stay. The
    next questions request opens a fresh attempt from question 1.
    """

    run = _locked_run(user=user, run_id=run_id)
    if run.status != ActiveStudyRun.Status.ACTIVE or run.stage not in {
        ActiveStudyRun.Stage.CHECKPOINT,
        ActiveStudyRun.Stage.FINAL,
    }:
        raise ManagedActiveStudyRuleError("There is no open question attempt to discard.")
    kind = (
        ActiveStudyAttempt.Kind.FINAL
        if run.stage == ActiveStudyRun.Stage.FINAL
        else ActiveStudyAttempt.Kind.CHECKPOINT
    )
    part = None if kind == ActiveStudyAttempt.Kind.FINAL else run.current_part
    run.attempts.filter(kind=kind, part_number=part, submitted_at__isnull=True).delete()
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


@transaction.atomic
def restart(*, user: User, run_id: UUID) -> ActiveStudyRun:
    """Replace this difficulty's active run with a fresh first-part run atomically."""

    current = _locked_run(user=user, run_id=run_id)
    if current.status != ActiveStudyRun.Status.ACTIVE:
        raise ManagedActiveStudyRuleError("Only an active Active Study run can be restarted.")
    sheet_id = cast(UUID, current.sheet_id)
    difficulty = current.difficulty
    edition = current.edition
    abandon(user=user, run_id=run_id)
    fresh, created = start(
        user=user,
        sheet_id=sheet_id,
        difficulty=difficulty,
        edition=edition,
        study_mode=current.study_mode,
        **(
            {
                key: current.plan_signature[key]
                for key in ("pages_per_checkpoint", "questions_per_checkpoint")
            }
            if current.study_mode == "custom"
            else {}
        ),
    )
    if not created:
        raise ManagedActiveStudyRuleError("Active Study could not be restarted. Try again.")
    return fresh


# --- Offline Active Study -------------------------------------------------
#
# A device that downloaded a sheet runs this state machine locally and later
# replays what the student did. The replay never trusts a client score, stage
# or reward: it drives the functions above, so grading, unlocking, Review Bank
# events and the once-only XP award stay exactly as they are online.

OFFLINE_APPLIED = "applied"
OFFLINE_DUPLICATE = "duplicate"
OFFLINE_SUPERSEDED = "superseded"


class OfflineReplayOutOfOrder(ManagedActiveStudyRuleError):
    """The server run is not at the stage this offline event was recorded at."""


def _offline_question(item: dict[str, Any]) -> dict[str, Any]:
    return {
        **({"type": item["type"]} if "type" in item else {}),
        "question": item["question"],
        **({"options": item["options"]} if item.get("type", "mcq") == "mcq" else {}),
        "correct_answer": item["correct_answer"],
        "explanation": item["explanation"],
    }


def offline_bundle(*, user: User, sheet_id: UUID, edition: str = UNIVERSITY) -> dict[str, Any]:
    """Everything one edition's Active Study needs to run on the device.

    It carries the answer keys, so it is served only to a reader who can open
    the sheet now; the caller also requires a premium subscription. Only
    difficulties the online runtime would start are included.
    """

    edition = normalize_edition(edition)
    sheet = _sheet_for_user(user=user, sheet_id=sheet_id)
    summary = availability(user=user, sheet_id=sheet_id, edition=edition)
    total_pages, _ = resolve_total_pdf_pages(
        settings=settings_for(sheet=sheet, edition=edition),
        source_version=source_version_for(sheet),
        edition=edition,
    )
    difficulties: dict[str, Any] = {}
    for row in cast(list[dict[str, Any]], summary["difficulties"]):
        if row["status"] != "ready":
            continue
        try:
            content, plan = _content(sheet=sheet, difficulty=row["difficulty"], edition=edition)
        except ManagedActiveStudyRuleError:
            continue
        payload = cast(dict[str, Any], content.payload)
        difficulties[row["difficulty"]] = {
            "number_of_parts": plan["number_of_parts"],
            "page_ranges": plan["page_ranges"],
            "content_revision": content.revision,
            "questions_per_checkpoint": plan["questions_per_checkpoint"],
            "source_page_ranges": content.plan_signature["page_ranges"],
            **({"pages": payload["pages"]} if "pages" in payload else {}),
            "rules": {
                "checkpoint_pass": ceil(cast(int, plan["questions_per_checkpoint"]) * 2 / 3),
                "final_pass": ceil(cast(int, plan["final_exam_questions"]) * 7 / 10),
            },
            "parts": [
                {
                    "part": part["part"],
                    "questions": [_offline_question(item) for item in part["questions"]],
                }
                for part in (
                    cast(list[dict[str, Any]], payload["parts"])
                    if "parts" in payload
                    else [
                        {
                            "part": r["part"],
                            "questions": select_page_questions(
                                payload,
                                r["start_page"],
                                r["end_page"],
                                plan["questions_per_checkpoint"],
                            ),
                        }
                        for r in content.plan_signature["page_ranges"]
                    ]
                )
            ],
            "final_exam": {
                "questions": [
                    _offline_question(item)
                    for item in cast(list[dict[str, Any]], payload["final_exam"]["questions"])
                ]
            },
        }
    return {
        "sheet_id": str(sheet.id),
        "edition": edition,
        "total_pdf_pages": total_pages,
        "rules": {"checkpoint_pass": CHECKPOINT_PASS, "final_pass": FINAL_EXAM_PASS},
        "availability": summary,
        "difficulties": difficulties,
    }


def _attempt_result(attempt: ActiveStudyAttempt) -> dict[str, Any]:
    run = attempt.run
    return {
        "score": attempt.score,
        "total": attempt.total,
        "passed": attempt.passed,
        "completed": run.status == ActiveStudyRun.Status.COMPLETED,
        "xp_awarded": run.xp_awarded,
    }


def _offline_outcome(status: str, run: ActiveStudyRun | None, **extra: Any) -> dict[str, Any]:
    return {"status": status, "run": run_payload(run), **extra}


def _completed_run_exists(
    *,
    user: User,
    sheet: LearningObject,
    difficulty: str,
    edition: str,
    study_mode: str = "standard",
) -> bool:
    return ActiveStudyRun.objects.filter(
        user=user,
        sheet=sheet,
        difficulty=difficulty,
        edition=edition,
        status=ActiveStudyRun.Status.COMPLETED,
        study_mode=study_mode,
    ).exists()


def _validated_answers(raw: object, *, total: int) -> list[tuple[int, str]]:
    if not isinstance(raw, list) or len(raw) != total:
        raise ManagedActiveStudyRuleError("Answer every question before submitting.")
    answers: dict[int, str] = {}
    for item in raw:
        if not isinstance(item, dict):
            raise ManagedActiveStudyRuleError("Question position is invalid.")
        position, selected = item.get("position"), item.get("selected_answer")
        if (
            not isinstance(position, int)
            or isinstance(position, bool)
            or position < 1
            or position > total
            or position in answers
        ):
            raise ManagedActiveStudyRuleError("Question position is invalid.")
        if selected not in ANSWER_KEYS:
            raise ManagedActiveStudyRuleError("Choose an answer for this question.")
        answers[position] = cast(str, selected)
    return sorted(answers.items())


@transaction.atomic
def replay_offline_attempt(
    *,
    user: User,
    sheet_id: UUID,
    edition: str,
    difficulty: str,
    kind: str,
    part: int | None,
    attempt_id: UUID,
    answers: object,
    study_mode: str = "standard",
    pages_per_checkpoint: int | None = None,
    questions_per_checkpoint: int | None = None,
    bank_revision: int | None = None,
) -> dict[str, Any]:
    """Replay one checkpoint or final exam the device completed offline.

    The attempt ID is the device's and becomes the server attempt's primary
    key, so a retried upload finds the attempt it already created and returns
    that result instead of grading, unlocking or awarding a second time.
    """

    edition = normalize_edition(edition)
    _difficulty(difficulty)
    if kind not in {ActiveStudyAttempt.Kind.CHECKPOINT, ActiveStudyAttempt.Kind.FINAL}:
        raise ManagedActiveStudyRuleError("Unsupported Active Study attempt.")
    if kind == ActiveStudyAttempt.Kind.FINAL:
        part = None
    elif not isinstance(part, int) or isinstance(part, bool) or part < 1:
        raise ManagedActiveStudyRuleError("Part is invalid.")
    sheet = _sheet_for_user(user=user, sheet_id=sheet_id)

    existing = (
        ActiveStudyAttempt.objects.select_for_update(of=("self",))
        .select_related("run")
        .filter(id=attempt_id)
        .first()
    )
    if existing is not None:
        if (
            existing.run.user_id != user.id
            or existing.run.sheet_id != sheet.id
            or existing.run.difficulty != difficulty
            or existing.run.edition != edition
            or existing.run.study_mode != study_mode
            or existing.kind != kind
            or existing.part_number != part
        ):
            raise ManagedActiveStudyRuleError("This attempt belongs to a different session.")
        if existing.submitted_at is not None:
            return _offline_outcome(
                OFFLINE_DUPLICATE, existing.run, result=_attempt_result(existing)
            )

    active = _active_run(
        user=user, sheet=sheet, difficulty=difficulty, edition=edition, study_mode=study_mode
    )
    if active is None:
        if kind == ActiveStudyAttempt.Kind.FINAL or part != 1:
            if _completed_run_exists(
                user=user,
                sheet=sheet,
                difficulty=difficulty,
                edition=edition,
                study_mode=study_mode,
            ):
                return _offline_outcome(OFFLINE_SUPERSEDED, None)
            raise OfflineReplayOutOfOrder("This Active Study session is no longer active.")
        active, _ = start(
            user=user,
            sheet_id=sheet.id,
            difficulty=difficulty,
            edition=edition,
            study_mode=study_mode,
            pages_per_checkpoint=pages_per_checkpoint,
            questions_per_checkpoint=questions_per_checkpoint,
        )
    run = _locked_run(user=user, run_id=active.id)
    if study_mode == "custom" and any(
        run.plan_signature.get(k) != v
        for k, v in (
            ("pages_per_checkpoint", pages_per_checkpoint),
            ("questions_per_checkpoint", questions_per_checkpoint),
        )
    ):
        raise ManagedActiveStudyRuleError("Offline settings do not match this custom session.")
    if (
        run.plan_signature.get("content_revision") is not None
        and bank_revision != run.plan_signature["content_revision"]
    ):
        raise ManagedActiveStudyRuleError(
            "Downloaded questions changed; refresh the sheet before syncing this attempt."
        )

    if kind == ActiveStudyAttempt.Kind.CHECKPOINT:
        if part in cast(list[int], run.completed_parts) or cast(int, part) < run.current_part:
            return _offline_outcome(OFFLINE_SUPERSEDED, run)
        if cast(int, part) > run.current_part:
            raise OfflineReplayOutOfOrder("An earlier part has not been completed yet.")
        if run.stage == ActiveStudyRun.Stage.CHECKPOINT_RESULT:
            study_again(user=user, run_id=run.id)
        if _locked_run(user=user, run_id=run.id).stage == ActiveStudyRun.Stage.READING:
            complete_part_reading(user=user, run_id=run.id)
    elif run.stage == ActiveStudyRun.Stage.FINAL_RESULT:
        retry_final(user=user, run_id=run.id)
    elif run.stage != ActiveStudyRun.Stage.FINAL:
        raise OfflineReplayOutOfOrder("The final exam is not unlocked yet.")
    run = _locked_run(user=user, run_id=run.id)

    source = _questions_for(run, kind=kind, part=part)
    validated = _validated_answers(answers, total=len(source))
    if existing is not None and existing.run_id != run.id:
        raise ManagedActiveStudyRuleError("This attempt belongs to a different session.")
    if existing is None:
        # The device's attempt is the one the student finished; an attempt
        # opened online and never submitted is replaced, as Restart does.
        run.attempts.filter(kind=kind, part_number=part, submitted_at__isnull=True).delete()
        number = run.attempts.filter(kind=kind, part_number=part).count() + 1
        ActiveStudyAttempt.objects.create(
            id=attempt_id, run=run, kind=kind, part_number=part, number=number, total=len(source)
        )
    for position, selected in validated:
        answer(
            user=user,
            run_id=run.id,
            attempt_id=attempt_id,
            position=position,
            selected_answer=selected,
        )
    run, result = submit(user=user, run_id=run.id, attempt_id=attempt_id)
    return _offline_outcome(OFFLINE_APPLIED, run, result=result)


@transaction.atomic
def replay_offline_continue(
    *,
    user: User,
    sheet_id: UUID,
    edition: str,
    difficulty: str,
    part: int,
    study_mode: str = "standard",
    pages_per_checkpoint: int | None = None,
    questions_per_checkpoint: int | None = None,
    bank_revision: int | None = None,
) -> dict[str, Any]:
    """Replay "continue anyway" after a checkpoint failed offline."""

    edition = normalize_edition(edition)
    _difficulty(difficulty)
    sheet = _sheet_for_user(user=user, sheet_id=sheet_id)
    active = _active_run(
        user=user, sheet=sheet, difficulty=difficulty, edition=edition, study_mode=study_mode
    )
    if active is None:
        if _completed_run_exists(
            user=user, sheet=sheet, difficulty=difficulty, edition=edition, study_mode=study_mode
        ):
            return _offline_outcome(OFFLINE_SUPERSEDED, None)
        raise OfflineReplayOutOfOrder("This Active Study session is no longer active.")
    if study_mode == "custom" and (
        active.plan_signature.get("pages_per_checkpoint") != pages_per_checkpoint
        or active.plan_signature.get("questions_per_checkpoint") != questions_per_checkpoint
        or active.plan_signature.get("content_revision") != bank_revision
    ):
        raise ManagedActiveStudyRuleError("Offline settings do not match this custom session.")
    if part in cast(list[int], active.completed_parts) or part < active.current_part:
        return _offline_outcome(OFFLINE_SUPERSEDED, active)
    if part > active.current_part or active.stage != ActiveStudyRun.Stage.CHECKPOINT_RESULT:
        raise OfflineReplayOutOfOrder("This checkpoint has no result to continue from.")
    return _offline_outcome(OFFLINE_APPLIED, continue_anyway(user=user, run_id=active.id))


@transaction.atomic
def replay_offline_restart(
    *,
    user: User,
    sheet_id: UUID,
    edition: str,
    difficulty: str,
    study_mode: str = "standard",
    pages_per_checkpoint: int | None = None,
    questions_per_checkpoint: int | None = None,
    bank_revision: int | None = None,
) -> dict[str, Any]:
    """Replay Restart: abandon the active run, if any, and begin again at Part 1."""

    edition = normalize_edition(edition)
    _difficulty(difficulty)
    sheet = _sheet_for_user(user=user, sheet_id=sheet_id)
    active = _active_run(
        user=user, sheet=sheet, difficulty=difficulty, edition=edition, study_mode=study_mode
    )
    if active is not None:
        if study_mode != "custom" or (
            active.plan_signature.get("pages_per_checkpoint") == pages_per_checkpoint
            and active.plan_signature.get("questions_per_checkpoint") == questions_per_checkpoint
        ):
            return _offline_outcome(OFFLINE_APPLIED, restart(user=user, run_id=active.id))
        abandon(user=user, run_id=active.id)
    run, _ = start(
        user=user,
        sheet_id=sheet.id,
        difficulty=difficulty,
        edition=edition,
        study_mode=study_mode,
        pages_per_checkpoint=pages_per_checkpoint,
        questions_per_checkpoint=questions_per_checkpoint,
    )
    return _offline_outcome(OFFLINE_APPLIED, run)

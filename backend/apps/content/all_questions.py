"""All Questions: one prompt, one JSON document, every question bank of a sheet.

This is orchestration only.  It owns no model, no question schema and no plan:

* part counts and page ranges come from :func:`active_study_plan_preview`, the
  planner Admin already previews and saves through, for the selected edition;
* every Active Study question is held to :func:`validate_active_study_questions`
  and saved through :func:`save_active_study_question_content`, so each
  difficulty's parts and its own Final Exam land in the bank they always did;
* Normal Sheet Questions are converted to ``lockin_questions_v1`` and imported
  through :func:`import_questions`, the Question import Admin already uses.
  Each imported question carries :data:`ALL_QUESTIONS_ORIGIN` in its version
  metadata; the next run archives only questions with that mark, so manual
  imports, hand-written and custom exam questions are never touched.

Everything is validated before anything is written, and the save runs in one
transaction, so a bad Hard Final Exam never leaves Easy and Medium half saved.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID

from django.db import transaction
from django.db.models import Q, QuerySet

from apps.accounts.models import User
from apps.audit.services import record_audit
from apps.questions.admin_services import bulk_question_action, import_questions
from apps.questions.importing import (
    MAX_IMPORT_QUESTIONS,
    SCHEMA_VERSION,
    QuestionImportValidationError,
    validate_question_import,
)
from apps.questions.models import Question

from .active_study import DIFFICULTIES, difficulty_for_key
from .active_study_questions import (
    ActiveStudyQuestionValidationError,
    validate_active_study_questions,
    validate_question_object,
)
from .active_study_readiness import effective_settings
from .admin_services import (
    active_study_plan_preview,
    save_active_study_question_content,
    update_active_study_settings,
)
from .editions import LOCKIN, edition_label, normalize_edition
from .models import ActiveStudyQuestionContent, LearningObject
from .services import ContentConflictError

# A fully broken paste of several hundred questions can produce thousands of
# errors; the first ones are what an administrator can act on.
MAX_REPORTED_ERRORS = 200
DIFFICULTY_LABELS = {"easy": "Easy", "medium": "Medium", "hard": "Hard"}
SHEET_QUESTIONS_LABEL = "Normal Questions"
_PAGES = re.compile(r"^\s*(\d+)\s*(?:[-–—]\s*(\d+)\s*)?$")
_INDEX = re.compile(r"\[(\d+)\]")

# Stored on the version of every Normal Question All Questions imports. It is
# the only thing that identifies them: questions imported through the Question
# import, written by hand or added as custom exam questions never carry it.
ALL_QUESTIONS_ORIGIN_KEY = "import_origin"
ALL_QUESTIONS_ORIGIN_VALUE = "all_questions"
ALL_QUESTIONS_ORIGIN: dict[str, object] = {ALL_QUESTIONS_ORIGIN_KEY: ALL_QUESTIONS_ORIGIN_VALUE}


class AllQuestionsValidationError(ValueError):
    def __init__(self, errors: list[dict[str, str]], summary: dict[str, object]) -> None:
        super().__init__("All Questions validation failed.")
        self.errors = errors
        self.summary = summary

    def as_dict(self) -> dict[str, object]:
        return {
            "valid": False,
            "error_count": len(self.errors),
            "errors": self.errors[:MAX_REPORTED_ERRORS],
            "summary": self.summary,
        }


@dataclass(frozen=True, slots=True)
class AllQuestionsValidation:
    context: dict[str, object]
    difficulty_payloads: dict[str, dict[str, object]]
    sheet_question_import: dict[str, object] | None
    summary: dict[str, object]

    def as_dict(self) -> dict[str, object]:
        return {"valid": True, "error_count": 0, "errors": [], "summary": self.summary}


def _sheet_question_count(sheet: LearningObject) -> int:
    """Live Normal (AI Sheet) questions; custom exam questions are a separate list."""

    return (
        Question.objects.filter(current_version__source_learning_object=sheet)
        .exclude(workflow_status=Question.WorkflowStatus.RETIRED)
        .filter(
            Q(current_version__metadata__source__isnull=True)
            | ~Q(current_version__metadata__source="exam")
        )
        .count()
    )


def all_questions_sheet_questions(sheet: LearningObject) -> QuerySet[Question]:
    """Live Normal Questions an earlier All Questions run imported into this sheet.

    Matched by the origin mark and an import batch, and only while the question
    still belongs to this sheet: a question moved elsewhere stays where it is.
    """

    return (
        Question.objects.filter(
            import_batch__isnull=False,
            current_version__source_learning_object=sheet,
            **{
                f"current_version__metadata__{ALL_QUESTIONS_ORIGIN_KEY}": ALL_QUESTIONS_ORIGIN_VALUE
            },
        )
        .exclude(workflow_status=Question.WorkflowStatus.RETIRED)
        .order_by("id")
    )


def all_questions_context(
    *,
    sheet: LearningObject,
    edition: str,
    excluded_start_pages: int | None = None,
    excluded_end_pages: int | None = None,
) -> dict[str, object]:
    """What one All Questions run generates for this edition and these exclusions.

    Omitted exclusions keep the edition's saved Active Study exclusions, exactly
    as the Active Study preview does.
    """

    edition = normalize_edition(edition)
    plan = active_study_plan_preview(
        sheet=sheet,
        excluded_start_pages=excluded_start_pages,
        excluded_end_pages=excluded_end_pages,
        edition=edition,
    )
    effective = effective_settings(sheet=sheet, edition=edition)
    contents = {
        content.difficulty: content
        for content in ActiveStudyQuestionContent.objects.filter(sheet=sheet)
    }
    difficulties: list[dict[str, object]] = []
    for row in cast(list[dict[str, object]], plan["difficulties"]):
        key = str(row["difficulty"])
        parts = cast(int, row["number_of_parts"])
        per_part = cast(int, row["questions_per_checkpoint"])
        final = cast(int, row["final_exam_questions"])
        content = contents.get(key)
        difficulties.append(
            {
                "difficulty": key,
                "label": DIFFICULTY_LABELS[key],
                "number_of_parts": parts,
                "page_ranges": row["page_ranges"],
                "questions_per_checkpoint": per_part,
                "final_exam_questions": final,
                "prompt_template_supported": row["prompt_template_supported"],
                "part_question_total": parts * per_part,
                "total": parts * per_part + final,
                "existing": {
                    "revision": content.revision if content is not None else 0,
                    "checkpoint_question_count": (
                        content.checkpoint_question_count if content is not None else 0
                    ),
                    "final_exam_question_count": (
                        content.final_exam_question_count if content is not None else 0
                    ),
                },
            }
        )
    total = cast(int, plan["total_pdf_pages"])
    start = cast(int, plan["excluded_start_pages"])
    end = cast(int, plan["excluded_end_pages"])
    return {
        "edition": edition,
        "edition_label": edition_label(edition),
        # One sheet, one question bank: the Lock-in edition plans its own pages
        # but writes into the same bank as the University Sheet.
        "shared_question_bank": edition == LOCKIN,
        "active_study_enabled": effective.enabled,
        "settings_revision": effective.own.revision if effective.own is not None else 0,
        "saved_excluded_start_pages": effective.excluded_start_pages,
        "saved_excluded_end_pages": effective.excluded_end_pages,
        "exclusions_changed": (start, end)
        != (effective.excluded_start_pages, effective.excluded_end_pages),
        "total_pdf_pages": total,
        "excluded_start_pages": start,
        "excluded_end_pages": end,
        "eligible_study_pages": plan["eligible_study_pages"],
        "effective_start_page": start + 1,
        "effective_end_page": total - end,
        "difficulties": difficulties,
        "active_study_total": sum(cast(int, item["total"]) for item in difficulties),
        "sheet_questions": {
            "existing_count": _sheet_question_count(sheet),
            # The part of existing_count a new run replaces; the rest stays.
            "all_questions_count": all_questions_sheet_questions(sheet).count(),
            "max_count": MAX_IMPORT_QUESTIONS,
        },
    }


def _section(path: str) -> str:
    """``active_study.hard.parts[2].questions[7]`` -> ``Hard → Part 3 → Question 8``."""

    labels: list[str] = []
    rest = path
    match = re.match(r"^active_study\.(easy|medium|hard)", path)
    if match:
        labels.append(DIFFICULTY_LABELS[match.group(1)])
        rest = path[match.end() :]
        part = re.match(r"^\.parts\[(\d+)\]", rest)
        if part:
            labels.append(f"Part {int(part.group(1)) + 1}")
            rest = rest[part.end() :]
        elif rest.startswith(".final_exam"):
            labels.append("Final Exam")
            rest = rest[len(".final_exam") :]
    elif path.startswith("sheet_questions"):
        labels.append(SHEET_QUESTIONS_LABEL)
        rest = path[len("sheet_questions") :]
    elif path.startswith("active_study"):
        labels.append("Active Study")
    question = re.search(r"questions\[(\d+)\]", rest)
    if question:
        labels.append(f"Question {int(question.group(1)) + 1}")
    return " → ".join(labels) or "JSON"


def _value_at(payload: Any, path: str) -> Any:
    """Follow a validator path back into the pasted JSON, or ``None``."""

    current = payload
    for token in re.findall(r"[^.\[\]]+|\[\d+\]", path):
        if token.startswith("["):
            index = int(token[1:-1])
            if not isinstance(current, list) or index >= len(current):
                return None
            current = current[index]
        else:
            if not isinstance(current, dict):
                return None
            current = current.get(token)
    return current


def _finish_errors(errors: list[dict[str, str]], payload: Any) -> list[dict[str, str]]:
    finished: list[dict[str, str]] = []
    for item in errors:
        message = item["message"]
        if item["path"].endswith(".correct_answer"):
            received = _value_at(payload, item["path"])
            if received is not None:
                message = f"Invalid correct_answer: {received!r}. {message}"
        finished.append(
            {"path": item["path"], "section": _section(item["path"]), "message": message}
        )
    return finished


def _count(value: Any) -> int:
    return len(value) if isinstance(value, list) else 0


def _raw_part_index(raw_parts: Any, number: int) -> int | None:
    """The pasted position of part ``number``: by its number, else by order."""

    if not isinstance(raw_parts, list):
        return None
    for index, item in enumerate(raw_parts):
        if isinstance(item, dict) and item.get("part") == number:
            return index
    return number - 1 if number - 1 < len(raw_parts) else None


def _has_error(errors: list[dict[str, str]], prefix: str) -> bool:
    return any(
        item["path"] == prefix
        or item["path"].startswith(prefix + ".")
        or item["path"].startswith(prefix + "[")
        for item in errors
    )


def _pages_match(value: Any, start: int, end: int) -> bool:
    if isinstance(value, int) and not isinstance(value, bool):
        return start == end == value
    if not isinstance(value, str):
        return False
    match = _PAGES.match(value)
    if not match:
        return False
    first = int(match.group(1))
    last = int(match.group(2)) if match.group(2) else first
    return (first, last) == (start, end)


def _validate_difficulty(
    raw: Any, *, row: dict[str, object], errors: list[dict[str, str]]
) -> dict[str, object] | None:
    key = str(row["difficulty"])
    label = DIFFICULTY_LABELS[key]
    prefix = f"active_study.{key}"
    if raw is None:
        errors.append({"path": prefix, "message": f"{label} is missing."})
        return None
    if not isinstance(raw, dict):
        errors.append(
            {"path": prefix, "message": f"{label} must be an object with parts and final_exam."}
        )
        return None
    ranges = cast(list[dict[str, int]], row["page_ranges"])
    # ``pages`` is only an echo of the plan for the AI and for this check; the
    # stored bank keeps the existing per-difficulty shape without it.
    stripped: dict[str, Any] = dict(raw)
    raw_parts = raw.get("parts")
    if isinstance(raw_parts, list):
        parts: list[Any] = []
        for index, part in enumerate(raw_parts):
            if isinstance(part, dict) and "pages" in part:
                part = dict(part)
                pages = part.pop("pages")
                number = part.get("part")
                planned = (
                    ranges[number - 1]
                    if isinstance(number, int)
                    and not isinstance(number, bool)
                    and 1 <= number <= len(ranges)
                    else (ranges[index] if index < len(ranges) else None)
                )
                if planned is not None and not _pages_match(
                    pages, planned["start_page"], planned["end_page"]
                ):
                    errors.append(
                        {
                            "path": f"{prefix}.parts[{index}].pages",
                            "message": (
                                f"Expected pages {planned['start_page']}-{planned['end_page']}, "
                                f"received {pages!r}."
                            ),
                        }
                    )
            parts.append(part)
        stripped["parts"] = parts
    try:
        result = validate_active_study_questions(
            stripped,
            difficulty=difficulty_for_key(key),
            number_of_parts=cast(int, row["number_of_parts"]),
        )
    except ActiveStudyQuestionValidationError as error:
        for item in error.errors:
            if item["path"] == "final_exam" and "final_exam" not in raw:
                message = f"{label} Final Exam is missing."
            else:
                message = item["message"]
            errors.append({"path": f"{prefix}.{item['path']}", "message": message})
        return None
    return result.payload


def _validate_sheet_questions(
    raw: Any, *, expected: int, errors: list[dict[str, str]]
) -> dict[str, object] | None:
    """Normal Questions in the A-D shape, returned as a ``lockin_questions_v1`` import."""

    prefix = "sheet_questions"
    if expected == 0:
        received = _count(raw.get("questions")) if isinstance(raw, dict) else 0
        if received:
            errors.append(
                {
                    "path": f"{prefix}.questions",
                    "message": f"Expected 0 questions (none were requested). Received {received}.",
                }
            )
        return None
    if raw is None:
        errors.append({"path": prefix, "message": "Normal Questions are missing."})
        return None
    if not isinstance(raw, dict):
        errors.append(
            {"path": prefix, "message": "sheet_questions must be an object with questions."}
        )
        return None
    for key in sorted(set(raw) - {"questions"}):
        errors.append({"path": f"{prefix}.{key}", "message": "Unsupported sheet_questions field."})
    raw_questions = raw.get("questions")
    if not isinstance(raw_questions, list):
        errors.append({"path": f"{prefix}.questions", "message": "questions must be an array."})
        return None
    if len(raw_questions) != expected:
        errors.append(
            {
                "path": f"{prefix}.questions",
                "message": f"Expected {expected} questions. Received {len(raw_questions)}.",
            }
        )
    own_errors: list[dict[str, str]] = []
    questions = [
        validate_question_object(item, errors=own_errors, path=f"{prefix}.questions[{index}]")
        for index, item in enumerate(raw_questions)
    ]
    seen: set[str] = set()
    for index, question in enumerate(questions):
        normalized = " ".join(str(question.get("question", "")).split()).casefold()
        if normalized and normalized in seen:
            own_errors.append(
                {
                    "path": f"{prefix}.questions[{index}].question",
                    "message": "Duplicate question text is not allowed within Normal Questions.",
                }
            )
        seen.add(normalized)
    errors.extend(own_errors)
    if own_errors or len(raw_questions) != expected:
        return None
    import_payload: dict[str, object] = {
        "version": SCHEMA_VERSION,
        "questions": [
            {
                "type": "mcq",
                "question": question["question"],
                "choices": [
                    cast(dict[str, str], question["options"])[key] for key in ("A", "B", "C", "D")
                ],
                "correct_answer": cast(dict[str, str], question["options"])[
                    cast(str, question["correct_answer"])
                ],
                "explanation": question["explanation"],
            }
            for question in questions
        ],
    }
    # The Question import's own limits (lengths, choice rules) still apply.
    try:
        validate_question_import(import_payload)
    except QuestionImportValidationError as error:
        for item in error.errors:
            position = item.get("index")
            path = (
                f"{prefix}.questions[{position}].{item.get('field')}"
                if isinstance(position, int)
                else f"{prefix}.{item.get('field')}"
            )
            errors.append({"path": path, "message": str(item.get("message"))})
        return None
    return import_payload


def _summary(
    *,
    payload: Any,
    context: dict[str, object],
    sheet_question_count: int,
    errors: list[dict[str, str]],
) -> dict[str, object]:
    active = payload.get("active_study") if isinstance(payload, dict) else None
    active = active if isinstance(active, dict) else {}
    rows: list[dict[str, object]] = []
    total_received = 0
    for row in cast(list[dict[str, object]], context["difficulties"]):
        key = str(row["difficulty"])
        prefix = f"active_study.{key}"
        raw = active.get(key)
        raw = raw if isinstance(raw, dict) else {}
        raw_parts = raw.get("parts")
        per_part = cast(int, row["questions_per_checkpoint"])
        parts: list[dict[str, object]] = []
        for planned in cast(list[dict[str, int]], row["page_ranges"]):
            index = _raw_part_index(raw_parts, planned["part"])
            raw_part = cast(list[Any], raw_parts)[index] if index is not None else None
            received = _count(raw_part.get("questions")) if isinstance(raw_part, dict) else 0
            parts.append(
                {
                    "part": planned["part"],
                    "start_page": planned["start_page"],
                    "end_page": planned["end_page"],
                    "expected": per_part,
                    "received": received,
                    "ok": received == per_part
                    and index is not None
                    and not _has_error(errors, f"{prefix}.parts[{index}]"),
                }
            )
        final_raw = raw.get("final_exam")
        final_received = _count(final_raw.get("questions")) if isinstance(final_raw, dict) else 0
        final_expected = cast(int, row["final_exam_questions"])
        part_received = sum(cast(int, item["received"]) for item in parts)
        total_received += part_received + final_received
        rows.append(
            {
                "difficulty": key,
                "label": row["label"],
                "number_of_parts": row["number_of_parts"],
                "parts": parts,
                "final_exam": {
                    "expected": final_expected,
                    "received": final_received,
                    "ok": final_received == final_expected
                    and not _has_error(errors, f"{prefix}.final_exam"),
                },
                "part_question_total": row["part_question_total"],
                "part_questions_received": part_received,
                "total": row["total"],
                "ok": not _has_error(errors, prefix),
            }
        )
    sheet_raw = payload.get("sheet_questions") if isinstance(payload, dict) else None
    sheet_received = _count(sheet_raw.get("questions")) if isinstance(sheet_raw, dict) else 0
    total_received += sheet_received
    return {
        "difficulties": rows,
        "sheet_questions": {
            "expected": sheet_question_count,
            "received": sheet_received,
            "ok": sheet_received == sheet_question_count
            and not _has_error(errors, "sheet_questions"),
        },
        "total_expected": cast(int, context["active_study_total"]) + sheet_question_count,
        "total_received": total_received,
    }


def validate_all_questions(
    *,
    sheet: LearningObject,
    payload: Any,
    edition: str,
    sheet_question_count: int,
    excluded_start_pages: int | None = None,
    excluded_end_pages: int | None = None,
) -> AllQuestionsValidation:
    """Validate the whole document against the selected edition's plan, writing nothing."""

    context = all_questions_context(
        sheet=sheet,
        edition=edition,
        excluded_start_pages=excluded_start_pages,
        excluded_end_pages=excluded_end_pages,
    )
    errors: list[dict[str, str]] = []
    difficulty_payloads: dict[str, dict[str, object]] = {}
    sheet_question_import: dict[str, object] | None = None
    if not isinstance(payload, dict):
        errors.append(
            {
                "path": "payload",
                "message": "The JSON must be one object with active_study and sheet_questions.",
            }
        )
    else:
        for key in sorted(set(payload) - {"active_study", "sheet_questions"}):
            errors.append({"path": key, "message": "Unsupported root field."})
        active = payload.get("active_study")
        if not isinstance(active, dict):
            errors.append(
                {
                    "path": "active_study",
                    "message": "active_study must be an object with easy, medium and hard.",
                }
            )
            active = {}
        for key in sorted(set(active) - {item.key for item in DIFFICULTIES}):
            errors.append(
                {
                    "path": f"active_study.{key}",
                    "message": (
                        "There is no shared Final Exam. Each difficulty has its own: "
                        "active_study.easy.final_exam, active_study.medium.final_exam and "
                        "active_study.hard.final_exam."
                        if key == "final_exam"
                        else "Unsupported difficulty. Use easy, medium and hard."
                    ),
                }
            )
        for row in cast(list[dict[str, object]], context["difficulties"]):
            normalized = _validate_difficulty(
                active.get(str(row["difficulty"])), row=row, errors=errors
            )
            if normalized is not None:
                difficulty_payloads[str(row["difficulty"])] = normalized
        sheet_question_import = _validate_sheet_questions(
            payload.get("sheet_questions"), expected=sheet_question_count, errors=errors
        )
    summary = _summary(
        payload=payload,
        context=context,
        sheet_question_count=sheet_question_count,
        errors=errors,
    )
    if errors:
        raise AllQuestionsValidationError(_finish_errors(errors, payload), summary)
    return AllQuestionsValidation(
        context=context,
        difficulty_payloads=difficulty_payloads,
        sheet_question_import=sheet_question_import,
        summary=summary,
    )


@transaction.atomic
def save_all_questions(
    *,
    actor: User,
    sheet_id: UUID,
    payload: Any,
    edition: str,
    sheet_question_count: int,
    excluded_start_pages: int | None,
    excluded_end_pages: int | None,
    settings_revision: int,
    expected_revisions: dict[str, int],
    publish_sheet_questions: bool,
) -> dict[str, object]:
    """Validate everything, then save everything -- or nothing.

    Each bank is written by its existing save path, inside this one
    transaction: any failure, including a revision conflict on the last bank,
    rolls every earlier write back.
    """

    edition = normalize_edition(edition)
    sheet = LearningObject.objects.select_for_update().get(id=sheet_id)
    validation = validate_all_questions(
        sheet=sheet,
        payload=payload,
        edition=edition,
        sheet_question_count=sheet_question_count,
        excluded_start_pages=excluded_start_pages,
        excluded_end_pages=excluded_end_pages,
    )
    context = validation.context
    boundaries_updated = bool(context["exclusions_changed"])
    if boundaries_updated:
        # The exclusions the prompt was built from become the edition's Active
        # Study exclusions through the ordinary settings save. Every bank is
        # replaced below, so the boundary change is confirmed by this save.
        update_active_study_settings(
            actor=actor,
            sheet_id=sheet.id,
            expected_revision=settings_revision,
            enabled=bool(context["active_study_enabled"]),
            total_pdf_pages=None,
            excluded_start_pages=cast(int, context["excluded_start_pages"]),
            excluded_end_pages=cast(int, context["excluded_end_pages"]),
            confirm_boundary_change=True,
            edition=edition,
        )
    elif context["settings_revision"] != settings_revision:
        raise ContentConflictError("These Active Study settings changed. Reload and try again.")
    for difficulty in DIFFICULTIES:
        save_active_study_question_content(
            actor=actor,
            sheet_id=sheet.id,
            difficulty_key=difficulty.key,
            payload=validation.difficulty_payloads[difficulty.key],
            expected_revision=int(expected_revisions.get(difficulty.key, 0)),
            edition=edition,
        )
    batch_id: str | None = None
    replaced_sheet_questions = 0
    if validation.sheet_question_import is not None:
        # Replace, never accumulate: archive (soft-retire, as "Archive selected"
        # does) the previous All Questions Normal Questions, then import the new
        # batch. Attempts and history keep the archived versions. A run with no
        # Normal Questions leaves the previous ones alone.
        previous = list(all_questions_sheet_questions(sheet).values_list("id", flat=True))
        if previous:
            bulk_question_action(actor=actor, question_ids=previous, action="archive")
        replaced_sheet_questions = len(previous)
        batch, _ = import_questions(
            actor=actor,
            sheet=sheet,
            payload=validation.sheet_question_import,
            publish=publish_sheet_questions,
            metadata=ALL_QUESTIONS_ORIGIN,
        )
        batch_id = str(batch.id)
    summary = validation.summary
    record_audit(
        actor=actor,
        action="content.all_questions_saved",
        domain="content",
        target_type="content.learning_object",
        target_id=str(sheet.id),
        reason="All Questions saved.",
        source="content_management.api",
        metadata={
            "edition": edition,
            "boundaries_updated": boundaries_updated,
            "total_questions": summary["total_expected"],
            "sheet_question_count": sheet_question_count,
            "sheet_question_batch_id": batch_id,
            "replaced_sheet_question_count": replaced_sheet_questions,
        },
    )
    return {
        "saved": True,
        "edition": edition,
        "boundaries_updated": boundaries_updated,
        "sheet_question_batch_id": batch_id,
        "replaced_sheet_question_count": replaced_sheet_questions,
        "summary": summary,
    }

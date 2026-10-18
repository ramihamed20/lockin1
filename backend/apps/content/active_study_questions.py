"""Validation contract for administrator-authored Active Study question JSON.

The difficulty is selected by the administrator from the surrounding Active
Study panel.  It is deliberately not inferred from individual questions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

from .active_study import ActiveStudyDifficulty
from .page_question_bank import LEGACY_QUESTIONS_PER_PAGE, QUESTIONS_PER_PAGE


class ActiveStudyQuestionValidationError(ValueError):
    def __init__(self, errors: list[dict[str, str]]) -> None:
        super().__init__("Active Study question validation failed.")
        self.errors = errors


@dataclass(frozen=True, slots=True)
class ActiveStudyQuestionValidationResult:
    payload: dict[str, object]
    checkpoint_question_count: int
    final_exam_question_count: int

    def as_dict(self) -> dict[str, object]:
        return {
            "valid": True,
            "checkpoint_question_count": self.checkpoint_question_count,
            "final_exam_question_count": self.final_exam_question_count,
            "payload": self.payload,
        }


def _error(errors: list[dict[str, str]], path: str, message: str) -> None:
    errors.append({"path": path, "message": message})


def _text(value: Any, *, errors: list[dict[str, str]], path: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _error(errors, path, f"{label} must be a non-empty string.")
        return ""
    return value.strip()


def _question(value: Any, *, errors: list[dict[str, str]], path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        _error(errors, path, "Each question must be a JSON object.")
        return {}
    question_type = value.get("type", "mcq")
    if question_type not in {"mcq", "true_false"}:
        _error(errors, f"{path}.type", "type must be mcq or true_false.")
        question_type = "mcq"
    allowed = {"type", "question", "correct_answer", "explanation"}
    if question_type == "mcq":
        allowed.add("options")
    for key in sorted(set(value) - allowed):
        _error(errors, f"{path}.{key}", "Unsupported question field.")
    for key in sorted({"question", "correct_answer", "explanation"} - set(value)):
        _error(errors, f"{path}.{key}", "This field is required.")

    question = _text(
        value.get("question"),
        errors=errors,
        path=f"{path}.question",
        label="Question",
    )
    explanation = _text(
        value.get("explanation"),
        errors=errors,
        path=f"{path}.explanation",
        label="Explanation",
    )
    if question_type == "true_false":
        answer = value.get("correct_answer")
        if not isinstance(answer, bool):
            _error(errors, f"{path}.correct_answer", "True/false correct_answer must be a boolean.")
        return {
            "type": "true_false",
            "question": question,
            "correct_answer": answer,
            "explanation": explanation,
        }

    if "options" not in value:
        _error(errors, f"{path}.options", "This field is required.")
    raw_options = value.get("options")
    options: dict[str, str] = {}
    if not isinstance(raw_options, dict):
        _error(errors, f"{path}.options", "Options must be an object with A, B, C, and D.")
    else:
        expected_keys = {"A", "B", "C", "D"}
        for key in sorted(expected_keys - set(raw_options)):
            _error(errors, f"{path}.options.{key}", f"Option {key} is required.")
        for key in sorted(set(raw_options) - expected_keys):
            _error(errors, f"{path}.options.{key}", "Only options A, B, C, and D are allowed.")
        for key in ("A", "B", "C", "D"):
            options[key] = _text(
                raw_options.get(key),
                errors=errors,
                path=f"{path}.options.{key}",
                label=f"Option {key}",
            )
        normalized = [" ".join(item.split()).casefold() for item in options.values() if item]
        if len(normalized) != len(set(normalized)):
            _error(errors, f"{path}.options", "Options must not duplicate the same text.")

    answer = value.get("correct_answer")
    if answer not in {"A", "B", "C", "D"}:
        _error(errors, f"{path}.correct_answer", "correct_answer must be A, B, C, or D.")
        answer = ""
    return {
        **({"type": "mcq"} if "type" in value else {}),
        "question": question,
        "options": {key: options.get(key, "") for key in ("A", "B", "C", "D")},
        "correct_answer": answer,
        "explanation": explanation,
    }


def validate_question_object(
    value: Any, *, errors: list[dict[str, str]], path: str
) -> dict[str, object]:
    """Validate one typed question with the Active Study rules.

    Public so a caller importing several banks at once -- All Questions -- holds
    every question to this one contract instead of a copy of it.
    """

    return _question(value, errors=errors, path=path)


def validate_active_study_questions(
    payload: Any,
    *,
    difficulty: ActiveStudyDifficulty,
    number_of_parts: int,
    page_ranges: list[dict[str, int]] | None = None,
    question_format: str = "parts",
    max_questions_per_part: int | None = None,
) -> ActiveStudyQuestionValidationResult:
    """Validate and normalize one difficulty's complete JSON document."""
    errors: list[dict[str, str]] = []
    if not isinstance(payload, dict):
        raise ActiveStudyQuestionValidationError(
            [{"path": "payload", "message": "The import must be a JSON object."}]
        )
    if question_format == "pages":
        return _validate_page_bank(payload, difficulty=difficulty, page_ranges=page_ranges or [])
    allowed_root = {"parts", "final_exam", "difficulty"}
    for key in sorted(set(payload) - allowed_root):
        _error(errors, key, "Unsupported root field.")
    supplied_difficulty = payload.get("difficulty")
    if supplied_difficulty is not None and supplied_difficulty != difficulty.key:
        _error(
            errors,
            "difficulty",
            f"This content is being imported as {difficulty.key}; "
            "the optional difficulty must match it.",
        )

    raw_parts = payload.get("parts")
    parts: list[dict[str, object]] = []
    if not isinstance(raw_parts, list):
        _error(errors, "parts", "parts must be an array.")
    else:
        if len(raw_parts) != number_of_parts:
            _error(
                errors,
                "parts",
                f"Expected {number_of_parts} parts for {difficulty.key.title()}, "
                f"but received {len(raw_parts)}.",
            )
        part_numbers: list[int] = []
        for index, raw_part in enumerate(raw_parts):
            path = f"parts[{index}]"
            if not isinstance(raw_part, dict):
                _error(errors, path, "Each part must be a JSON object.")
                continue
            for key in sorted(set(raw_part) - {"part", "questions"}):
                _error(errors, f"{path}.{key}", "Unsupported part field.")
            part_number = raw_part.get("part")
            if isinstance(part_number, bool) or not isinstance(part_number, int):
                _error(errors, f"{path}.part", "Part number must be a positive integer.")
                part_number = 0
            part_numbers.append(part_number)
            raw_questions = raw_part.get("questions")
            questions: list[dict[str, object]] = []
            if not isinstance(raw_questions, list):
                _error(errors, f"{path}.questions", "questions must be an array.")
            else:
                if max_questions_per_part is not None:
                    if not 1 <= len(raw_questions) <= max_questions_per_part:
                        _error(
                            errors,
                            f"{path}.questions",
                            f"Page {part_number} contains {len(raw_questions)} questions. "
                            f"Expected 1 to {max_questions_per_part}.",
                        )
                elif len(raw_questions) != difficulty.questions_per_checkpoint:
                    _error(
                        errors,
                        f"{path}.questions",
                        f"Part {part_number} contains {len(raw_questions)} questions. "
                        f"Expected {difficulty.questions_per_checkpoint}.",
                    )
                questions = [
                    _question(item, errors=errors, path=f"{path}.questions[{question_index}]")
                    for question_index, item in enumerate(raw_questions)
                ]
            parts.append({"part": part_number, "questions": questions})
        expected_numbers = list(range(1, number_of_parts + 1))
        if sorted(part_numbers) != expected_numbers:
            _error(
                errors,
                "parts",
                "Part numbers must be consecutive: "
                f"{', '.join(str(value) for value in expected_numbers)}.",
            )

    raw_final_exam = payload.get("final_exam")
    final_questions: list[dict[str, object]] = []
    if not isinstance(raw_final_exam, dict):
        _error(errors, "final_exam", "final_exam must be an object.")
    else:
        for key in sorted(set(raw_final_exam) - {"questions"}):
            _error(errors, f"final_exam.{key}", "Unsupported final_exam field.")
        raw_questions = raw_final_exam.get("questions")
        if not isinstance(raw_questions, list):
            _error(errors, "final_exam.questions", "questions must be an array.")
        else:
            if len(raw_questions) != difficulty.final_exam_questions:
                _error(
                    errors,
                    "final_exam.questions",
                    f"Final Exam contains {len(raw_questions)} questions. "
                    f"Expected {difficulty.final_exam_questions}.",
                )
            final_questions = [
                _question(item, errors=errors, path=f"final_exam.questions[{index}]")
                for index, item in enumerate(raw_questions)
            ]

    seen_questions: set[str] = set()
    for part in parts:
        for question in cast(list[dict[str, object]], part["questions"]):
            normalized = " ".join(str(question.get("question", "")).split()).casefold()
            if normalized and normalized in seen_questions:
                _error(
                    errors,
                    "questions",
                    "Duplicate question text is not allowed within one difficulty import.",
                )
            seen_questions.add(normalized)
    for question in final_questions:
        normalized = " ".join(str(question.get("question", "")).split()).casefold()
        if normalized and normalized in seen_questions:
            _error(
                errors,
                "questions",
                "Duplicate question text is not allowed within one difficulty import.",
            )
        seen_questions.add(normalized)

    if errors:
        raise ActiveStudyQuestionValidationError(errors)
    normalized_payload: dict[str, object] = {
        "parts": sorted(parts, key=lambda item: cast(int, item["part"])),
        "final_exam": {"questions": final_questions},
    }
    question_count = 0
    for part in parts:
        question_count += len(cast(list[object], part["questions"]))
    return ActiveStudyQuestionValidationResult(
        payload=normalized_payload,
        checkpoint_question_count=question_count,
        final_exam_question_count=len(final_questions),
    )


def _validate_page_bank(
    payload: dict[str, Any], *, difficulty: ActiveStudyDifficulty, page_ranges: list[dict[str, int]]
) -> ActiveStudyQuestionValidationResult:
    """Reuse all question/final/duplicate checks through a temporary page-as-part projection."""
    errors: list[dict[str, str]] = []
    for key in sorted(set(payload) - {"pages", "final_exam", "difficulty"}):
        _error(errors, key, "Unsupported root field; this new sheet requires pages.")
    expected = [
        page for item in page_ranges for page in range(item["start_page"], item["end_page"] + 1)
    ]
    raw = payload.get("pages")
    if not isinstance(raw, list) or not expected:
        _error(errors, "pages", "pages must contain every eligible PDF page.")
        raw = []
    numbers = [item.get("page") if isinstance(item, dict) else None for item in raw]
    if (
        any(isinstance(n, bool) or not isinstance(n, int) for n in numbers)
        or sorted(n for n in numbers if isinstance(n, int)) != expected
    ):
        _error(errors, "pages", "Page numbers must match every eligible PDF page exactly once.")
    parts = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            _error(errors, f"pages[{index}]", "Each page must be an object.")
            continue
        for key in sorted(set(item) - {"page", "questions"}):
            _error(errors, f"pages[{index}].{key}", "Unsupported page field.")
        parts.append({"part": index + 1, "questions": item.get("questions")})
    if errors:
        raise ActiveStudyQuestionValidationError(errors)
    from dataclasses import replace

    # Older banks of exactly 20 per page remain valid without alteration.
    # New banks accept 1–15 questions per eligible page, never empty pages.
    per_page = (
        LEGACY_QUESTIONS_PER_PAGE
        if parts
        and all(
            isinstance(part["questions"], list)
            and len(part["questions"]) == LEGACY_QUESTIONS_PER_PAGE
            for part in parts
        )
        else QUESTIONS_PER_PAGE
    )
    page_limit = QUESTIONS_PER_PAGE if per_page == QUESTIONS_PER_PAGE else None
    try:
        checked = validate_active_study_questions(
            {
                "parts": parts,
                "final_exam": payload.get("final_exam"),
                **({"difficulty": payload["difficulty"]} if "difficulty" in payload else {}),
            },
            difficulty=replace(difficulty, questions_per_checkpoint=per_page),
            number_of_parts=len(expected),
            max_questions_per_part=page_limit,
        )
    except ActiveStudyQuestionValidationError as error:
        raise ActiveStudyQuestionValidationError(
            [
                {
                    "path": item["path"].replace("parts", "pages").replace(".part", ".page"),
                    "message": item["message"].replace("Part", "Page"),
                }
                for item in error.errors
            ]
        ) from error
    normalized = cast(list[dict[str, Any]], checked.payload["parts"])
    return ActiveStudyQuestionValidationResult(
        payload={
            "pages": sorted(
                [
                    {"page": numbers[i], "questions": part["questions"]}
                    for i, part in enumerate(normalized)
                ],
                key=lambda p: p["page"],
            ),
            "final_exam": checked.payload["final_exam"],
        },
        checkpoint_question_count=checked.checkpoint_question_count,
        final_exam_question_count=checked.final_exam_question_count,
    )

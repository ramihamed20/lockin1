from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any

from .models import QuestionVersion

SCHEMA_VERSION = "lockin_questions_v1"
MAX_IMPORT_QUESTIONS = 200
COMMON_FIELDS = {
    "type",
    "question",
    "explanation",
    "difficulty",
    "topic",
    "source_page",
}


class QuestionImportValidationError(ValueError):
    def __init__(self, errors: list[dict[str, object]]) -> None:
        super().__init__("Question import validation failed.")
        self.errors = errors


@dataclass(frozen=True, slots=True)
class ImportedQuestion:
    schema_type: str
    question_type: str
    prompt: str
    choices: tuple[str, ...]
    correct_answers: tuple[str, ...]
    explanation: str
    difficulty: str
    topic: str
    source_page: int | None

    def as_dict(self) -> dict[str, object]:
        return {
            "type": self.schema_type,
            "question": self.prompt,
            "choices": list(self.choices),
            "correct_answers": list(self.correct_answers),
            "explanation": self.explanation,
            "difficulty": self.difficulty,
            "topic": self.topic,
            "source_page": self.source_page,
        }


@dataclass(frozen=True, slots=True)
class ImportValidationResult:
    questions: tuple[ImportedQuestion, ...]
    type_counts: dict[str, int]
    warnings: tuple[dict[str, object], ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "version": SCHEMA_VERSION,
            "question_count": len(self.questions),
            "type_counts": self.type_counts,
            "warnings": list(self.warnings),
            "questions": [question.as_dict() for question in self.questions],
        }


def _error(errors: list[dict[str, object]], index: int | None, field: str, message: str) -> None:
    errors.append({"index": index, "field": field, "message": message})


def _clean_string(
    value: Any,
    *,
    errors: list[dict[str, object]],
    index: int,
    field: str,
    required: bool = False,
    max_length: int = 10_000,
) -> str:
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        _error(errors, index, field, f"{field} must be a string.")
        return ""
    clean = value.strip()
    if required and not clean:
        _error(errors, index, field, f"{field} is required.")
    if len(clean) > max_length:
        _error(errors, index, field, f"{field} exceeds {max_length} characters.")
    return clean


def _choices(value: Any, *, errors: list[dict[str, object]], index: int) -> tuple[str, ...]:
    if not isinstance(value, list) or not 2 <= len(value) <= 12:
        _error(errors, index, "choices", "choices must contain between 2 and 12 strings.")
        return ()
    choices: list[str] = []
    for choice_index, item in enumerate(value):
        choice = _clean_string(
            item,
            errors=errors,
            index=index,
            field=f"choices[{choice_index}]",
            required=True,
            max_length=2000,
        )
        choices.append(choice)
    normalized = [" ".join(choice.split()).casefold() for choice in choices]
    if len(set(normalized)) != len(normalized):
        _error(errors, index, "choices", "choices must be unique.")
    return tuple(choices)


def validate_question_import(payload: Any) -> ImportValidationResult:
    errors: list[dict[str, object]] = []
    warnings: list[dict[str, object]] = []
    if not isinstance(payload, dict):
        raise QuestionImportValidationError(
            [{"index": None, "field": "payload", "message": "The import must be a JSON object."}]
        )
    unknown_root = sorted(set(payload) - {"version", "questions"})
    for field in unknown_root:
        _error(errors, None, field, f"Unsupported root field: {field}.")
    if payload.get("version") != SCHEMA_VERSION:
        _error(errors, None, "version", f"Schema version must be {SCHEMA_VERSION}.")
    raw_questions = payload.get("questions")
    if not isinstance(raw_questions, list) or not 1 <= len(raw_questions) <= MAX_IMPORT_QUESTIONS:
        _error(
            errors,
            None,
            "questions",
            f"questions must contain between 1 and {MAX_IMPORT_QUESTIONS} items.",
        )
        raise QuestionImportValidationError(errors)

    normalized_questions: list[ImportedQuestion] = []
    for index, raw in enumerate(raw_questions):
        if not isinstance(raw, dict):
            _error(errors, index, "question", "Each question must be a JSON object.")
            continue
        schema_type = raw.get("type")
        type_fields = {
            "mcq": {"choices", "correct_answer"},
            "true_false": {"correct_answer"},
            "multiple_select": {"choices", "correct_answers"},
        }
        if schema_type not in type_fields:
            _error(
                errors,
                index,
                "type",
                "Supported types are mcq, true_false, and multiple_select.",
            )
            continue
        allowed = COMMON_FIELDS | type_fields[str(schema_type)]
        for field in sorted(set(raw) - allowed):
            _error(errors, index, field, f"Unsupported field for {schema_type}: {field}.")
        prompt = _clean_string(
            raw.get("question"), errors=errors, index=index, field="question", required=True
        )
        explanation = _clean_string(
            raw.get("explanation", ""), errors=errors, index=index, field="explanation"
        )
        if not explanation:
            warnings.append(
                {"index": index, "field": "explanation", "message": "Explanation is empty."}
            )
        topic = _clean_string(
            raw.get("topic", ""),
            errors=errors,
            index=index,
            field="topic",
            max_length=220,
        )
        difficulty = raw.get("difficulty", QuestionVersion.Difficulty.MEDIUM)
        if difficulty not in QuestionVersion.Difficulty.values:
            _error(errors, index, "difficulty", "Difficulty must be easy, medium, or hard.")
            difficulty = QuestionVersion.Difficulty.MEDIUM
        source_page = raw.get("source_page")
        if source_page is not None and (
            isinstance(source_page, bool) or not isinstance(source_page, int) or source_page < 1
        ):
            _error(errors, index, "source_page", "source_page must be null or a positive integer.")
            source_page = None

        choices: tuple[str, ...]
        correct_answers: tuple[str, ...]
        question_type: str
        if schema_type == "true_false":
            correct = raw.get("correct_answer")
            if not isinstance(correct, bool):
                _error(
                    errors,
                    index,
                    "correct_answer",
                    "True/false correct_answer must be a boolean.",
                )
                correct = True
            choices = ("True", "False")
            correct_answers = ("True" if correct else "False",)
            question_type = QuestionVersion.QuestionType.TRUE_FALSE
        elif schema_type == "mcq":
            choices = _choices(raw.get("choices"), errors=errors, index=index)
            answer = raw.get("correct_answer")
            if not isinstance(answer, str) or answer not in choices:
                _error(
                    errors,
                    index,
                    "correct_answer",
                    "correct_answer must exactly match one choice.",
                )
                correct_answers = ()
            else:
                correct_answers = (answer,)
            question_type = QuestionVersion.QuestionType.SINGLE_CHOICE
        else:
            choices = _choices(raw.get("choices"), errors=errors, index=index)
            answers = raw.get("correct_answers")
            if (
                not isinstance(answers, list)
                or len(answers) < 2
                or any(not isinstance(answer, str) for answer in answers)
            ):
                _error(
                    errors,
                    index,
                    "correct_answers",
                    "correct_answers must contain at least two choice strings.",
                )
                correct_answers = ()
            else:
                correct_answers = tuple(answers)
                if len(set(correct_answers)) != len(correct_answers):
                    _error(errors, index, "correct_answers", "correct_answers must be unique.")
                if set(correct_answers) - set(choices):
                    _error(
                        errors,
                        index,
                        "correct_answers",
                        "Every correct answer must exist in choices.",
                    )
            question_type = QuestionVersion.QuestionType.MULTIPLE_SELECT

        normalized_questions.append(
            ImportedQuestion(
                schema_type=str(schema_type),
                question_type=question_type,
                prompt=prompt,
                choices=choices,
                correct_answers=correct_answers,
                explanation=explanation,
                difficulty=str(difficulty),
                topic=topic,
                source_page=source_page,
            )
        )
    if errors:
        raise QuestionImportValidationError(errors)
    counts = dict(Counter(question.schema_type for question in normalized_questions))
    return ImportValidationResult(
        questions=tuple(normalized_questions),
        type_counts=counts,
        warnings=tuple(warnings),
    )

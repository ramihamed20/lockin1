"""Typed Active Study input keeps configured totals and legacy MCQ content."""

import pytest

from apps.content.active_study import ActiveStudyDifficulty
from apps.content.active_study_questions import (
    ActiveStudyQuestionValidationError,
    validate_active_study_questions,
)


def _mcq(index: int) -> dict[str, object]:
    return {
        "question": f"MCQ {index}?",
        "options": {"A": "First", "B": "Second", "C": "Third", "D": "Fourth"},
        "correct_answer": "B",
        "explanation": "Second is correct.",
    }


def _true_false(index: int, answer: bool) -> dict[str, object]:
    return {
        "type": "true_false",
        "question": f"Statement {index}.",
        "correct_answer": answer,
        "explanation": "The statement can be checked in the sheet.",
    }


def test_mixed_questions_follow_configured_totals_without_a_type_ratio() -> None:
    difficulty = ActiveStudyDifficulty(
        "medium", target_pages_per_part=5, questions_per_checkpoint=3, final_exam_questions=2
    )
    payload = {
        "parts": [{"part": 1, "questions": [_mcq(1), _true_false(2, True), _true_false(3, False)]}],
        "final_exam": {"questions": [_true_false(4, True), _mcq(5)]},
    }
    result = validate_active_study_questions(payload, difficulty=difficulty, number_of_parts=1)
    assert result.checkpoint_question_count == 3
    assert result.final_exam_question_count == 2
    assert result.payload["parts"][0]["questions"][0] == _mcq(1)
    assert result.payload["parts"][0]["questions"][1]["correct_answer"] is True


def test_true_false_requires_boolean_and_no_fake_options() -> None:
    difficulty = ActiveStudyDifficulty(
        "easy", target_pages_per_part=5, questions_per_checkpoint=1, final_exam_questions=1
    )
    invalid = _true_false(1, True)
    invalid["correct_answer"] = "True"
    invalid["options"] = {"A": "True", "B": "False"}
    payload = {
        "parts": [{"part": 1, "questions": [invalid]}],
        "final_exam": {"questions": [_mcq(2)]},
    }
    with pytest.raises(ActiveStudyQuestionValidationError) as raised:
        validate_active_study_questions(payload, difficulty=difficulty, number_of_parts=1)
    paths = {error["path"] for error in raised.value.errors}
    assert "parts[0].questions[0].correct_answer" in paths
    assert "parts[0].questions[0].options" in paths

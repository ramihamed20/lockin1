from apps.accounts.models import User
from apps.education.models import EducationNode

from ..models import Question, QuestionVersion
from ..services import (
    QuestionInput,
    QuestionOptionInput,
    create_question,
    publish_question,
    submit_question_for_review,
)


def question_input(
    *,
    node: EducationNode,
    prompt: str = "Which cranial nerve controls facial expression?",
    correct_index: int = 1,
    difficulty: str = QuestionVersion.Difficulty.MEDIUM,
    question_type: str = QuestionVersion.QuestionType.SINGLE_CHOICE,
) -> QuestionInput:
    labels: tuple[str, ...] = ("Trigeminal nerve", "Facial nerve", "Vagus nerve")
    if question_type == QuestionVersion.QuestionType.TRUE_FALSE:
        labels = ("True", "False")
    return QuestionInput(
        academic_node=node,
        question_type=question_type,
        prompt=prompt,
        explanation="The facial nerve supplies the muscles of facial expression.",
        difficulty=difficulty,
        options=tuple(
            QuestionOptionInput(text=label, is_correct=index == correct_index)
            for index, label in enumerate(labels)
        ),
    )


def published_question(
    *,
    actor: User,
    node: EducationNode,
    prompt: str = "Which cranial nerve controls facial expression?",
    difficulty: str = QuestionVersion.Difficulty.MEDIUM,
) -> Question:
    question = create_question(
        actor=actor,
        data=question_input(node=node, prompt=prompt, difficulty=difficulty),
    )
    question = submit_question_for_review(
        actor=actor,
        question_id=question.id,
        expected_revision=question.revision,
    )
    return publish_question(
        actor=actor,
        question_id=question.id,
        expected_revision=question.revision,
    )

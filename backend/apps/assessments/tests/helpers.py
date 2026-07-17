from datetime import datetime, timedelta
from decimal import Decimal

from django.utils import timezone

from apps.accounts.models import User
from apps.education.models import EducationNode
from apps.questions.models import Question

from ..models import Quiz, QuizVersion
from ..quiz_services import (
    QuizInput,
    create_quiz,
    publish_quiz,
    submit_quiz_for_review,
)


def published_quiz(
    *,
    actor: User,
    node: EducationNode,
    questions: tuple[Question, ...],
    mode: str = QuizVersion.Mode.QUIZ,
    selection_mode: str = QuizVersion.SelectionMode.FIXED,
    result_release: str = QuizVersion.ResultRelease.IMMEDIATE,
    available_until: datetime | None = None,
    title: str = "Cranial nerves checkpoint",
) -> Quiz:
    versions = tuple(
        question.published_version
        for question in questions
        if question.published_version is not None
    )
    quiz = create_quiz(
        actor=actor,
        data=QuizInput(
            academic_node=node,
            title=title,
            instructions="Choose the best answer.",
            mode=mode,
            selection_mode=selection_mode,
            question_count=len(questions),
            question_versions=(
                versions if selection_mode == QuizVersion.SelectionMode.FIXED else ()
            ),
            duration_seconds=None if mode == QuizVersion.Mode.PRACTICE else 600,
            maximum_attempts=0 if mode == QuizVersion.Mode.PRACTICE else 2,
            available_from=timezone.now() - timedelta(hours=1),
            available_until=available_until,
            result_release=result_release,
            pass_percent=Decimal("60.00"),
            focus_required=True,
            allowed_difficulties=("easy", "medium", "hard"),
        ),
    )
    quiz = submit_quiz_for_review(
        actor=actor,
        quiz_id=quiz.id,
        expected_revision=quiz.revision,
    )
    return publish_quiz(
        actor=actor,
        quiz_id=quiz.id,
        expected_revision=quiz.revision,
    )

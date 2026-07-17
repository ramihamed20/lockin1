from dataclasses import dataclass
from uuid import UUID

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role
from apps.content.models import LearningObject
from apps.content.selectors import published_learning_object
from apps.education.models import EducationNode
from apps.education.policies import can_create_content, is_administrator
from apps.questions.models import Question
from apps.questions.selectors import published_question

from .models import LearningContextType


class CommunityContextError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ContextSnapshot:
    context_type: str
    context_id: UUID
    title: str
    route: str
    academic_node: EducationNode


def resolve_context(*, user: User, context_type: str, context_id: UUID) -> ContextSnapshot:
    if context_type == LearningContextType.LESSON:
        try:
            node = EducationNode.objects.get(
                id=context_id,
                kind=EducationNode.Kind.LESSON,
                is_discoverable=True,
            )
        except EducationNode.DoesNotExist as error:
            raise CommunityContextError("Learning context not found.") from error
        return ContextSnapshot(context_type, node.id, node.title, f"/learn/nodes/{node.id}", node)

    if context_type == LearningContextType.LEARNING_OBJECT:
        try:
            learning_object = published_learning_object(learning_object_id=context_id)
        except LearningObject.DoesNotExist as error:
            raise CommunityContextError("Learning context not found.") from error
        content_version = learning_object.published_version
        if content_version is None:
            raise CommunityContextError("Learning context not found.")
        return ContextSnapshot(
            context_type,
            learning_object.id,
            content_version.title,
            f"/learn/content/{learning_object.id}",
            content_version.academic_node,
        )

    if context_type == LearningContextType.QUESTION:
        try:
            question = published_question(question_id=context_id)
        except Question.DoesNotExist as error:
            raise CommunityContextError("Learning context not found.") from error
        question_version = question.published_version
        if question_version is None:
            raise CommunityContextError("Learning context not found.")
        return ContextSnapshot(
            context_type,
            question.id,
            question_version.prompt,
            "/assessments",
            question_version.academic_node,
        )

    if context_type == LearningContextType.QUIZ:
        from apps.assessments.models import Quiz
        from apps.assessments.selectors import published_quiz

        try:
            quiz = published_quiz(quiz_id=context_id)
        except Quiz.DoesNotExist as error:
            raise CommunityContextError("Learning context not found.") from error
        quiz_version = quiz.published_version
        if quiz_version is None:
            raise CommunityContextError("Learning context not found.")
        return ContextSnapshot(
            context_type,
            quiz.id,
            quiz_version.title,
            f"/assessments/quizzes/{quiz.id}",
            quiz_version.academic_node,
        )

    raise CommunityContextError("Unsupported learning context.")


def can_create_space_for_context(*, user: User, context: ContextSnapshot) -> bool:
    if is_administrator(user):
        return True
    return user_has_role(user, Role.CREATOR) and can_create_content(
        user=user,
        node=context.academic_node,
    )

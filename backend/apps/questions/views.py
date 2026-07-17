from typing import Any
from uuid import UUID

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.education.models import EducationNode
from apps.education.permissions import IsCreatorOrAdministrator

from .models import Question
from .selectors import manageable_questions
from .serializers import (
    QuestionManagementSerializer,
    QuestionUpdateSerializer,
    QuestionWriteSerializer,
    RejectQuestionSerializer,
    RevisionActionSerializer,
)
from .services import (
    QuestionConflictError,
    QuestionInput,
    QuestionOptionInput,
    QuestionRuleError,
    create_question,
    publish_question,
    reject_question,
    retire_question,
    revise_question,
    submit_question_for_review,
)


class QuestionConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This question changed. Reload it and try again."
    default_code = "revision_conflict"


class QuestionRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "question_rule_rejected"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _rule_error(error: QuestionRuleError) -> APIException:
    message = str(error)
    lowered = message.lower()
    if lowered.startswith("you cannot") or lowered.startswith("only administrators"):
        return PermissionDenied(message)
    return QuestionRejected(message)


def _write_input(data: dict[str, Any]) -> QuestionInput:
    return QuestionInput(
        academic_node=get_object_or_404(EducationNode, id=data["academic_node_id"]),
        question_type=str(data["question_type"]),
        prompt=str(data["prompt"]),
        explanation=str(data.get("explanation", "")),
        difficulty=str(data["difficulty"]),
        language=str(data["language"]),
        metadata=dict(data.get("metadata", {})),
        options=tuple(
            QuestionOptionInput(
                text=str(option["text"]),
                is_correct=bool(option.get("is_correct", False)),
            )
            for option in data["options"]
        ),
    )


class ManagementQuestionListView(ListAPIView[Question]):
    permission_classes = [IsCreatorOrAdministrator]
    serializer_class = QuestionManagementSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        queryset = manageable_questions(user=_user(self.request))
        workflow_status = self.request.query_params.get("status")
        if workflow_status:
            queryset = queryset.filter(workflow_status=workflow_status)
        return queryset

    def post(self, request: Request) -> Response:
        serializer = QuestionWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            question = create_question(
                actor=_user(request),
                data=_write_input(dict(serializer.validated_data)),
            )
        except QuestionRuleError as error:
            raise _rule_error(error) from error
        return Response(
            QuestionManagementSerializer(question).data,
            status=status.HTTP_201_CREATED,
        )


class ManagementQuestionDetailView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def get(self, request: Request, question_id: UUID) -> Response:
        question = get_object_or_404(manageable_questions(user=_user(request)), id=question_id)
        return Response(QuestionManagementSerializer(question).data)

    def patch(self, request: Request, question_id: UUID) -> Response:
        serializer = QuestionUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        expected_revision = int(data.pop("expected_revision"))
        try:
            question = revise_question(
                actor=_user(request),
                question_id=question_id,
                expected_revision=expected_revision,
                data=_write_input(data),
            )
        except QuestionConflictError as error:
            raise QuestionConflict() from error
        except QuestionRuleError as error:
            raise _rule_error(error) from error
        return Response(QuestionManagementSerializer(question).data)


class _RevisionActionView(APIView):
    permission_classes = [IsCreatorOrAdministrator]
    action = staticmethod(submit_question_for_review)

    def post(self, request: Request, question_id: UUID) -> Response:
        serializer = RevisionActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            question = self.action(
                actor=_user(request),
                question_id=question_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except QuestionConflictError as error:
            raise QuestionConflict() from error
        except QuestionRuleError as error:
            raise _rule_error(error) from error
        return Response(QuestionManagementSerializer(question).data)


class SubmitQuestionView(_RevisionActionView):
    action = staticmethod(submit_question_for_review)


class PublishQuestionView(_RevisionActionView):
    action = staticmethod(publish_question)


class RetireQuestionView(_RevisionActionView):
    action = staticmethod(retire_question)


class RejectQuestionView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def post(self, request: Request, question_id: UUID) -> Response:
        serializer = RejectQuestionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            question = reject_question(
                actor=_user(request),
                question_id=question_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
                review_note=str(serializer.validated_data["review_note"]),
            )
        except QuestionConflictError as error:
            raise QuestionConflict() from error
        except QuestionRuleError as error:
            raise _rule_error(error) from error
        return Response(QuestionManagementSerializer(question).data)

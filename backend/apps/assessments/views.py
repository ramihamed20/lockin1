from decimal import Decimal
from typing import Any
from uuid import UUID

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.education.models import EducationNode
from apps.education.permissions import IsCreatorOrAdministrator
from apps.review.selectors import latest_mistakes
from apps.review.serializers import mistake_event_payload

from .attempt_services import (
    AttemptClosedError,
    AttemptConflictError,
    AttemptRuleError,
    create_question_issue_report,
    record_attempt_activity,
    refresh_attempt_state,
    save_answer,
    start_attempt,
    submit_attempt,
)
from .models import AttemptResult, Quiz
from .quiz_services import (
    QuizConflictError,
    QuizInput,
    QuizRuleError,
    create_quiz,
    publish_quiz,
    reject_quiz,
    resolve_question_versions,
    retire_quiz,
    revise_quiz,
    submit_quiz_for_review,
)
from .selectors import attempt_for_user, manageable_quizzes, published_quiz, published_quizzes
from .serializers import (
    AnswerSaveSerializer,
    AttemptActivitySerializer,
    AttemptActivityWriteSerializer,
    AttemptAnswerSerializer,
    AttemptResultSerializer,
    AttemptSerializer,
    AttemptStartSerializer,
    AttemptSubmitSerializer,
    QuestionIssueReportSerializer,
    QuestionIssueReportWriteSerializer,
    QuizManagementSerializer,
    QuizPublicSerializer,
    QuizUpdateSerializer,
    QuizWriteSerializer,
    RejectQuizSerializer,
    RevisionActionSerializer,
)


class QuizConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This quiz changed. Reload it and try again."
    default_code = "revision_conflict"


class QuizRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "quiz_rule_rejected"


class AttemptRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "attempt_rule_rejected"


class AttemptClosed(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "attempt_closed"


class AttemptRevisionConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "answer_revision_conflict"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _rule_error(error: QuizRuleError | AttemptRuleError) -> APIException:
    message = str(error)
    lowered = message.lower()
    if lowered.startswith("you cannot") or lowered.startswith("only administrators"):
        return PermissionDenied(message)
    return QuizRejected(message) if isinstance(error, QuizRuleError) else AttemptRejected(message)


def _quiz_input(*, actor: User, data: dict[str, Any]) -> QuizInput:
    academic_node = get_object_or_404(EducationNode, id=data["academic_node_id"])
    question_ids = tuple(data.get("question_ids", ()))
    return QuizInput(
        academic_node=academic_node,
        title=str(data["title"]),
        instructions=str(data.get("instructions", "")),
        mode=str(data["mode"]),
        selection_mode=str(data["selection_mode"]),
        question_count=int(data["question_count"]),
        question_versions=resolve_question_versions(
            actor=actor,
            question_ids=question_ids,
            academic_node=academic_node,
        ),
        duration_seconds=data.get("duration_seconds"),
        maximum_attempts=int(data["maximum_attempts"]),
        available_from=data.get("available_from"),
        available_until=data.get("available_until"),
        randomize_questions=bool(data["randomize_questions"]),
        randomize_options=bool(data["randomize_options"]),
        result_release=str(data["result_release"]),
        pass_percent=Decimal(data["pass_percent"]),
        ranking_eligible=bool(data["ranking_eligible"]),
        achievement_eligible=bool(data["achievement_eligible"]),
        focus_required=bool(data["focus_required"]),
        allowed_difficulties=tuple(data.get("allowed_difficulties", ())),
        language=str(data["language"]),
        metadata=dict(data.get("metadata", {})),
    )


class PublicQuizListView(ListAPIView[Quiz]):
    serializer_class = QuizPublicSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        raw_node = self.request.query_params.get("node")
        node_id = None
        if raw_node:
            try:
                node_id = UUID(raw_node)
            except ValueError as error:
                raise NotFound("Education node not found.") from error
        mode = self.request.query_params.get("mode") or None
        return published_quizzes(node_id=node_id, mode=mode)


class PublicQuizDetailView(APIView):
    def get(self, request: Request, quiz_id: UUID) -> Response:
        try:
            quiz = published_quiz(quiz_id=quiz_id)
        except Quiz.DoesNotExist as error:
            raise NotFound("Quiz not found.") from error
        return Response(QuizPublicSerializer(quiz).data)


class ManagementQuizListView(ListAPIView[Quiz]):
    permission_classes = [IsCreatorOrAdministrator]
    serializer_class = QuizManagementSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        queryset = manageable_quizzes(user=_user(self.request))
        workflow_status = self.request.query_params.get("status")
        if workflow_status:
            queryset = queryset.filter(workflow_status=workflow_status)
        return queryset

    def post(self, request: Request) -> Response:
        serializer = QuizWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            quiz = create_quiz(
                actor=_user(request),
                data=_quiz_input(actor=_user(request), data=dict(serializer.validated_data)),
            )
        except QuizRuleError as error:
            raise _rule_error(error) from error
        return Response(QuizManagementSerializer(quiz).data, status=status.HTTP_201_CREATED)


class ManagementQuizDetailView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def get(self, request: Request, quiz_id: UUID) -> Response:
        quiz = get_object_or_404(manageable_quizzes(user=_user(request)), id=quiz_id)
        return Response(QuizManagementSerializer(quiz).data)

    def patch(self, request: Request, quiz_id: UUID) -> Response:
        serializer = QuizUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        expected_revision = int(data.pop("expected_revision"))
        try:
            quiz = revise_quiz(
                actor=_user(request),
                quiz_id=quiz_id,
                expected_revision=expected_revision,
                data=_quiz_input(actor=_user(request), data=data),
            )
        except QuizConflictError as error:
            raise QuizConflict() from error
        except QuizRuleError as error:
            raise _rule_error(error) from error
        return Response(QuizManagementSerializer(quiz).data)


class _QuizRevisionActionView(APIView):
    permission_classes = [IsCreatorOrAdministrator]
    service_action = staticmethod(submit_quiz_for_review)

    def post(self, request: Request, quiz_id: UUID) -> Response:
        serializer = RevisionActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            quiz = self.service_action(
                actor=_user(request),
                quiz_id=quiz_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except QuizConflictError as error:
            raise QuizConflict() from error
        except QuizRuleError as error:
            raise _rule_error(error) from error
        return Response(QuizManagementSerializer(quiz).data)


class SubmitQuizView(_QuizRevisionActionView):
    service_action = staticmethod(submit_quiz_for_review)


class PublishQuizView(_QuizRevisionActionView):
    service_action = staticmethod(publish_quiz)


class RetireQuizView(_QuizRevisionActionView):
    service_action = staticmethod(retire_quiz)


class RejectQuizView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def post(self, request: Request, quiz_id: UUID) -> Response:
        serializer = RejectQuizSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            quiz = reject_quiz(
                actor=_user(request),
                quiz_id=quiz_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
                review_note=str(serializer.validated_data["review_note"]),
            )
        except QuizConflictError as error:
            raise QuizConflict() from error
        except QuizRuleError as error:
            raise _rule_error(error) from error
        return Response(QuizManagementSerializer(quiz).data)


class StartAttemptView(APIView):
    def post(self, request: Request, quiz_id: UUID) -> Response:
        serializer = AttemptStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            started = start_attempt(
                user=_user(request),
                quiz_id=quiz_id,
                idempotency_key=data["idempotency_key"],
                requested_question_count=data.get("question_count"),
                difficulties=tuple(data.get("difficulties", ())),
                review_only=bool(data["review_only"]),
            )
        except AttemptConflictError as error:
            raise AttemptRevisionConflict(str(error)) from error
        except AttemptRuleError as error:
            raise _rule_error(error) from error
        attempt = attempt_for_user(user=_user(request), attempt_id=started.attempt.id)
        return Response(
            {"resumed": started.resumed, "attempt": AttemptSerializer(attempt).data},
            status=status.HTTP_200_OK if started.resumed else status.HTTP_201_CREATED,
        )


class AttemptDetailView(APIView):
    def get(self, request: Request, attempt_id: UUID) -> Response:
        try:
            refresh_attempt_state(user=_user(request), attempt_id=attempt_id)
            attempt = attempt_for_user(user=_user(request), attempt_id=attempt_id)
        except (AttemptRuleError, QuizRuleError) as error:
            raise NotFound("Attempt not found.") from error
        return Response(AttemptSerializer(attempt).data)


class AttemptAnswerView(APIView):
    def put(self, request: Request, attempt_id: UUID, attempt_question_id: UUID) -> Response:
        serializer = AnswerSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            answer = save_answer(
                user=_user(request),
                attempt_id=attempt_id,
                attempt_question_id=attempt_question_id,
                selected_option_ids=tuple(data["selected_option_ids"]),
                client_revision=int(data["client_revision"]),
            )
        except AttemptConflictError as error:
            detail: dict[str, Any] = {"detail": str(error)}
            if error.current_answer is not None:
                detail["current_answer"] = AttemptAnswerSerializer(error.current_answer).data
            raise AttemptRevisionConflict(detail) from error
        except AttemptClosedError as error:
            raise AttemptClosed(str(error)) from error
        except AttemptRuleError as error:
            raise _rule_error(error) from error
        return Response(AttemptAnswerSerializer(answer).data)


class AttemptSubmitView(APIView):
    def post(self, request: Request, attempt_id: UUID) -> Response:
        serializer = AttemptSubmitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = submit_attempt(
                user=_user(request),
                attempt_id=attempt_id,
                idempotency_key=serializer.validated_data["idempotency_key"],
            )
        except AttemptConflictError as error:
            raise AttemptRevisionConflict(str(error)) from error
        except AttemptRuleError as error:
            raise _rule_error(error) from error
        result = _result_for_user(user=_user(request), result_id=result.id)
        return Response(AttemptResultSerializer(result).data)


def _result_for_user(*, user: User, result_id: UUID) -> AttemptResult:
    return get_object_or_404(
        AttemptResult.objects.filter(attempt__user=user)
        .select_related("attempt__quiz_version")
        .prefetch_related("attempt__questions__answer"),
        id=result_id,
    )


class AttemptResultView(APIView):
    def get(self, request: Request, result_id: UUID) -> Response:
        result = _result_for_user(user=_user(request), result_id=result_id)
        return Response(AttemptResultSerializer(result).data)


class AttemptActivityView(APIView):
    def post(self, request: Request, attempt_id: UUID) -> Response:
        serializer = AttemptActivityWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            activity = record_attempt_activity(
                user=_user(request),
                attempt_id=attempt_id,
                client_event_id=data["client_event_id"],
                activity_type=str(data["activity_type"]),
                client_occurred_at=data.get("client_occurred_at"),
                metadata=dict(data.get("metadata", {})),
            )
        except AttemptConflictError as error:
            raise AttemptRevisionConflict(str(error)) from error
        except AttemptRuleError as error:
            raise _rule_error(error) from error
        return Response(AttemptActivitySerializer(activity).data, status=status.HTTP_201_CREATED)


class QuestionIssueReportView(APIView):
    def post(self, request: Request, result_id: UUID) -> Response:
        serializer = QuestionIssueReportWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            report = create_question_issue_report(
                user=_user(request),
                result_id=result_id,
                attempt_question_id=data["attempt_question_id"],
                category=str(data["category"]),
                details=str(data["details"]),
            )
        except AttemptRuleError as error:
            raise _rule_error(error) from error
        return Response(
            QuestionIssueReportSerializer(report).data,
            status=status.HTTP_201_CREATED,
        )


class ReviewQueueView(APIView):
    def get(self, request: Request) -> Response:
        mistakes = list(latest_mistakes(user=_user(request), limit=4))
        return Response(
            {
                "count": len(mistakes),
                "results": [mistake_event_payload(item) for item in mistakes],
            }
        )

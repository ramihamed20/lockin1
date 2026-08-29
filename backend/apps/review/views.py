from uuid import UUID

from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .contracts import QuestionAttemptEvent
from .models import ReviewAnswerLog
from .selectors import (
    active_review_items,
    current_weekly_session,
    latest_mistakes,
    review_bank_overview,
    weekly_recall_eligible_count,
)
from .serializers import (
    QuestionAttemptWriteSerializer,
    ReviewAnswerWriteSerializer,
    mistake_event_payload,
    review_item_payload,
    weekly_session_payload,
)
from .services import (
    ReviewConflictError,
    ReviewRuleError,
    answer_review_item,
    create_or_resume_weekly_recall,
    record_question_attempt,
)


class ReviewRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "review_rule_rejected"


class ReviewConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "review_conflict"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _raise_rule(error: ReviewRuleError) -> None:
    if isinstance(error, ReviewConflictError):
        raise ReviewConflict(str(error)) from error
    raise ReviewRejected(str(error)) from error


class QuestionAttemptView(APIView):
    def post(self, request: Request) -> Response:
        serializer = QuestionAttemptWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        selected = tuple(str(value) for value in data["selected_option_ids"])
        correct = tuple(str(value) for value in data["correct_option_ids"])
        try:
            recorded = record_question_attempt(
                event=QuestionAttemptEvent(
                    user=_user(request),
                    event_key=f"client:{data['idempotency_key']}",
                    canonical_key=str(data["question_key"]),
                    subject_key=str(data["subject_key"]),
                    subject_label=str(data["subject_label"]),
                    source_type=str(data["source_type"]),
                    source_id=str(data.get("source_id", "")),
                    source_label=str(data.get("source_label", "")),
                    source_question_index=data.get("source_question_index"),
                    prompt=str(data["prompt"]),
                    explanation=str(data.get("explanation", "")),
                    options=tuple(
                        {"id": str(option["id"]), "text": str(option["text"])}
                        for option in data["options"]
                    ),
                    selected_option_ids=selected,
                    correct_option_ids=correct,
                    is_correct=set(selected) == set(correct),
                    answered_at=timezone.now(),
                )
            )
        except ReviewRuleError as error:
            _raise_rule(error)
        return Response(
            {
                "mistake_recorded": recorded.mistake_event is not None,
                "created": recorded.created,
                "review_item_id": recorded.review_item.id if recorded.review_item else None,
            },
            status=status.HTTP_201_CREATED if recorded.created else status.HTTP_200_OK,
        )


class ReviewQueueView(APIView):
    def get(self, request: Request) -> Response:
        items = list(latest_mistakes(user=_user(request), limit=4))
        return Response(
            {"count": len(items), "results": [mistake_event_payload(item) for item in items]}
        )


class ReviewBankView(APIView):
    def get(self, request: Request) -> Response:
        return Response(review_bank_overview(user=_user(request)))


class ReviewBankSubjectView(APIView):
    def get(self, request: Request, subject_key: str) -> Response:
        items = list(active_review_items(user=_user(request), subject_key=subject_key))
        return Response(
            {
                "subject_key": subject_key,
                "subject_label": items[0].subject_label_snapshot if items else None,
                "count": len(items),
                "results": [review_item_payload(item) for item in items],
            }
        )


class ReviewBankAnswerView(APIView):
    def post(self, request: Request, item_id: UUID) -> Response:
        serializer = ReviewAnswerWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = answer_review_item(
                user=_user(request),
                review_item_id=item_id,
                selected_option_ids=tuple(str(value) for value in data["selected_option_ids"]),
                idempotency_key=data["idempotency_key"],
                context=ReviewAnswerLog.Context.REVIEW_BANK,
            )
        except ReviewRuleError as error:
            _raise_rule(error)
        return Response(
            {
                "was_correct": result.answer_log.was_correct,
                "review_item": review_item_payload(result.review_item, reveal_answer=True),
                "mistake_event_id": result.mistake_event.id if result.mistake_event else None,
            }
        )


class WeeklyRecallView(APIView):
    def get(self, request: Request) -> Response:
        user = _user(request)
        session = current_weekly_session(user=user)
        if session is not None:
            return Response({"available": True, "session": weekly_session_payload(session)})
        eligible_count = weekly_recall_eligible_count(user=user)
        return Response(
            {
                "available": eligible_count > 0,
                "eligible_count": eligible_count,
                "session": None,
            }
        )

    def post(self, request: Request) -> Response:
        try:
            session, created = create_or_resume_weekly_recall(user=_user(request))
        except ReviewRuleError as error:
            _raise_rule(error)
        session = current_weekly_session(user=_user(request)) or session
        return Response(
            {"available": True, "session": weekly_session_payload(session)},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class WeeklyRecallAnswerView(APIView):
    def post(self, request: Request, session_id: UUID, question_id: UUID) -> Response:
        serializer = ReviewAnswerWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        session = current_weekly_session(user=_user(request))
        if session is None or session.id != session_id:
            raise ReviewRejected("Weekly Recall session not found.")
        weekly_question = next(
            (question for question in session.questions.all() if question.id == question_id),
            None,
        )
        if weekly_question is None:
            raise ReviewRejected("Weekly Recall question not found.")
        try:
            result = answer_review_item(
                user=_user(request),
                review_item_id=weekly_question.review_item_id,
                selected_option_ids=tuple(str(value) for value in data["selected_option_ids"]),
                idempotency_key=data["idempotency_key"],
                context=ReviewAnswerLog.Context.WEEKLY_RECALL,
                weekly_question_id=weekly_question.id,
            )
        except ReviewRuleError as error:
            _raise_rule(error)
        refreshed = current_weekly_session(user=_user(request)) or result.weekly_session
        return Response(
            {
                "was_correct": result.answer_log.was_correct,
                "review_item": review_item_payload(result.review_item, reveal_answer=True),
                "session": weekly_session_payload(refreshed),
                "mistake_event_id": result.mistake_event.id if result.mistake_event else None,
            }
        )

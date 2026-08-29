from __future__ import annotations

from collections import Counter
from uuid import UUID

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability
from apps.content.models import LearningObject, LearningObjectVersion

from .admin_serializers import (
    QuestionBulkActionSerializer,
    QuestionImportCommitSerializer,
    QuestionImportUndoSerializer,
    QuestionImportValidateSerializer,
)
from .admin_services import bulk_question_action, import_questions, undo_import
from .importing import QuestionImportValidationError, validate_question_import
from .models import Question, QuestionImportBatch, QuestionVersion
from .services import QuestionConflictError, QuestionRuleError


class AdminQuestionRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "admin_question_rejected"


class AdminQuestionConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "revision_conflict"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _raise_rule(error: Exception) -> None:
    if isinstance(error, QuestionConflictError):
        raise AdminQuestionConflict(str(error)) from error
    raise AdminQuestionRejected(str(error)) from error


class _AssessmentPermissionView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.ASSESSMENTS_VIEW

    def get_permissions(self):  # type: ignore[no-untyped-def]
        self.required_capability = (
            Capability.ASSESSMENTS_VIEW
            if self.request.method in {"GET", "HEAD", "OPTIONS"}
            else Capability.ASSESSMENTS_MANAGE
        )
        return super().get_permissions()


def _sheet(sheet_id: UUID) -> LearningObject:
    return get_object_or_404(
        LearningObject.objects.select_related("current_version__academic_node"),
        id=sheet_id,
        current_version__content_type=LearningObjectVersion.ContentType.PDF,
    )


def serialize_question(question: Question) -> dict[str, object]:
    version = question.current_version
    if version is None:
        raise AdminQuestionRejected("A question has no current version.")
    return {
        "id": str(question.id),
        "import_batch_id": str(question.import_batch_id) if question.import_batch_id else None,
        "workflow_status": question.workflow_status,
        "revision": question.revision,
        "question_type": version.question_type,
        "question": version.prompt,
        "choices": [
            {
                "id": str(option.id),
                "text": option.text,
                "position": option.position,
                "is_correct": option.is_correct,
            }
            for option in version.options.all()
        ],
        "explanation": version.explanation,
        "difficulty": version.difficulty,
        "topic": version.topic,
        "source_page": version.source_page,
        "sheet_id": (
            str(version.source_learning_object_id)
            if version.source_learning_object_id is not None
            else None
        ),
        "updated_at": question.updated_at,
    }


def serialize_batch(batch: QuestionImportBatch) -> dict[str, object]:
    sheet_version = batch.sheet.current_version
    return {
        "id": str(batch.id),
        "batch_id": f"question_import_{batch.id}",
        "created_at": batch.created_at,
        "admin": {
            "id": str(batch.actor_id),
            "name": batch.actor.full_name,
            "email": batch.actor.email,
        },
        "subject": {"id": str(batch.academic_node_id), "title": batch.academic_node.title},
        "sheet": {
            "id": str(batch.sheet_id),
            "title": sheet_version.title if sheet_version is not None else "Unavailable sheet",
        },
        "question_count": batch.question_count,
        "type_counts": batch.type_counts,
        "warnings": batch.warnings,
        "status": batch.status,
        "undone_at": batch.undone_at,
    }


class AdminSheetQuestionListView(_AssessmentPermissionView):
    def get(self, request: Request, sheet_id: UUID) -> Response:
        sheet = _sheet(sheet_id)
        questions = (
            Question.objects.filter(current_version__source_learning_object=sheet)
            .select_related("current_version", "import_batch")
            .prefetch_related("current_version__options")
            .order_by("-updated_at", "id")
        )
        workflow_status = request.query_params.get("status", "").strip()
        if workflow_status:
            if workflow_status not in Question.WorkflowStatus.values:
                raise AdminQuestionRejected("The question status filter is invalid.")
            questions = questions.filter(workflow_status=workflow_status)
        question_type = request.query_params.get("type", "").strip()
        if question_type:
            if question_type not in QuestionVersion.QuestionType.values:
                raise AdminQuestionRejected("The question type filter is invalid.")
            questions = questions.filter(current_version__question_type=question_type)
        difficulty = request.query_params.get("difficulty", "").strip()
        if difficulty:
            if difficulty not in QuestionVersion.Difficulty.values:
                raise AdminQuestionRejected("The difficulty filter is invalid.")
            questions = questions.filter(current_version__difficulty=difficulty)
        topic = request.query_params.get("topic", "").strip()[:220]
        if topic:
            questions = questions.filter(current_version__topic__iexact=topic)
        query = request.query_params.get("q", "").strip()[:100]
        if query:
            questions = questions.filter(
                Q(current_version__prompt__icontains=query)
                | Q(current_version__explanation__icontains=query)
                | Q(current_version__topic__icontains=query)
            )
        results = [serialize_question(question) for question in questions]
        counts = Counter(str(item["question_type"]) for item in results)
        all_topics = sorted(
            set(
                Question.objects.filter(current_version__source_learning_object=sheet)
                .exclude(current_version__topic="")
                .values_list("current_version__topic", flat=True)
            )
        )
        return Response(
            {
                "sheet": {
                    "id": str(sheet.id),
                    "title": sheet.current_version.title if sheet.current_version else "Sheet",
                    "subject_id": (
                        str(sheet.current_version.academic_node_id)
                        if sheet.current_version
                        else None
                    ),
                    "subject_title": (
                        sheet.current_version.academic_node.title
                        if sheet.current_version
                        else "Subject"
                    ),
                },
                "count": len(results),
                "type_counts": dict(counts),
                "topics": all_topics,
                "results": results,
            }
        )


class AdminQuestionImportValidateView(_AssessmentPermissionView):
    def post(self, request: Request, sheet_id: UUID) -> Response:
        _sheet(sheet_id)
        serializer = QuestionImportValidateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = validate_question_import(serializer.validated_data["payload"])
        except QuestionImportValidationError as error:
            return Response(
                {"valid": False, "errors": error.errors, "warnings": []},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"valid": True, **result.as_dict()})


class AdminQuestionImportView(_AssessmentPermissionView):
    def post(self, request: Request, sheet_id: UUID) -> Response:
        sheet = _sheet(sheet_id)
        serializer = QuestionImportCommitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            batch, validation = import_questions(
                actor=_user(request),
                sheet=sheet,
                payload=serializer.validated_data["payload"],
                publish=bool(serializer.validated_data["publish"]),
            )
        except QuestionImportValidationError as error:
            return Response(
                {"valid": False, "errors": error.errors, "warnings": []},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except QuestionRuleError as error:
            _raise_rule(error)
        return Response(
            {"batch": serialize_batch(batch), "validation": validation.as_dict()},
            status=status.HTTP_201_CREATED,
        )


class AdminQuestionBulkActionView(_AssessmentPermissionView):
    def post(self, request: Request) -> Response:
        serializer = QuestionBulkActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        target_id = data.get("target_sheet_id")
        target = _sheet(target_id) if target_id is not None else None
        try:
            result = bulk_question_action(
                actor=_user(request),
                question_ids=list(data["question_ids"]),
                action=str(data["action"]),
                target_sheet=target,
            )
        except QuestionRuleError as error:
            _raise_rule(error)
        return Response(result)


class AdminQuestionImportHistoryView(_AssessmentPermissionView):
    def get(self, request: Request) -> Response:
        batches = QuestionImportBatch.objects.select_related(
            "actor", "academic_node", "sheet__current_version"
        )
        status_filter = request.query_params.get("status", "").strip()
        if status_filter:
            if status_filter not in QuestionImportBatch.Status.values:
                raise AdminQuestionRejected("The import status filter is invalid.")
            batches = batches.filter(status=status_filter)
        results = [serialize_batch(batch) for batch in batches[:200]]
        return Response({"count": len(results), "results": results})


class AdminQuestionImportUndoView(_AssessmentPermissionView):
    def post(self, request: Request, batch_id: UUID) -> Response:
        serializer = QuestionImportUndoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expected = f"question_import_{batch_id}"
        if serializer.validated_data["confirmation"] != expected:
            raise AdminQuestionRejected("Type the full Import Batch ID to confirm undo.")
        try:
            batch = undo_import(actor=_user(request), batch_id=batch_id)
        except QuestionImportBatch.DoesNotExist as error:
            raise AdminQuestionRejected("Import batch not found.") from error
        except QuestionRuleError as error:
            _raise_rule(error)
        return Response(serialize_batch(batch))

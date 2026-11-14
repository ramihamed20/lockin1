from typing import cast
from uuid import UUID

from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts.models import User
from apps.content.admin_serializers import AdminAllQuestionsValidateSerializer
from apps.content.all_questions import AllQuestionsValidationError
from apps.content.services import ContentRuleError
from apps.questions.services import QuestionRuleError
from platform_core.api.serializers import StrictSerializer

from .automation import AutomationConflict, available_types
from .automation_views import AutomationView, JobConflict, job_data
from .models import AutomationArtifact, AutomationJob
from .question_review import review_action, review_candidate


class ReviewUpload(AdminAllQuestionsValidateSerializer):
    sheet_question_count = None  # type: ignore[assignment]
    excluded_start_pages = None  # type: ignore[assignment]
    excluded_end_pages = None  # type: ignore[assignment]
    expected_revision = serializers.IntegerField(min_value=1)


class ReviewAction(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(choices=("start", "reject", "approve"))


class QuestionReviewView(AutomationView):
    def _question_job(self, request: Request, job_id: UUID) -> AutomationJob:
        return get_object_or_404(self.visible_jobs(request), id=job_id, job_type="question_package")

    def get(self, request: Request, job_id: UUID) -> Response:
        job = self._question_job(request, job_id)
        artifact = get_object_or_404(
            job.artifacts,
            artifact_type=AutomationArtifact.Kind.QUESTION_CANDIDATE,
            validation_status=AutomationArtifact.Validation.VALID,
        )
        return Response(
            {
                "revision": job.revision,
                "payload": artifact.payload,
                "checksum": artifact.checksum,
            }
        )

    def put(self, request: Request, job_id: UUID) -> Response:
        self._question_job(request, job_id)
        actor = cast(User, request.user)
        if "question_package" not in available_types(actor, write=True):
            raise PermissionDenied()
        serializer = ReviewUpload(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            job, validation = review_candidate(
                actor=actor,
                job_id=job_id,
                revision=serializer.validated_data["expected_revision"],
                payload=serializer.validated_data["payload"],
            )
        except AutomationJob.DoesNotExist as error:
            raise NotFound() from error
        except AutomationConflict as error:
            raise JobConflict(str(error)) from error
        except AllQuestionsValidationError as error:
            return Response(error.as_dict(), status=400)
        return Response({"job": job_data(job), "validation": validation})

    def post(self, request: Request, job_id: UUID) -> Response:
        self._question_job(request, job_id)
        actor = cast(User, request.user)
        if "question_package" not in available_types(actor, write=True):
            raise PermissionDenied()
        serializer = ReviewAction(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            job = review_action(
                actor=actor,
                job_id=job_id,
                revision=serializer.validated_data["expected_revision"],
                action=serializer.validated_data["action"],
            )
        except (AutomationJob.DoesNotExist, AutomationArtifact.DoesNotExist) as error:
            raise NotFound() from error
        except (AutomationConflict, ContentRuleError, QuestionRuleError) as error:
            raise JobConflict(str(error)) from error
        except AllQuestionsValidationError as error:
            return Response(error.as_dict(), status=400)
        return Response(job_data(job))

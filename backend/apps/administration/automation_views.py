from typing import Any, cast
from uuid import UUID

from django.db.models import Count, QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.content.models import LearningObject, LearningObjectVersion
from apps.education.models import EducationNode
from apps.questions.importing import MAX_IMPORT_QUESTIONS
from platform_core.api.exceptions import RequestRejected
from platform_core.api.pagination import LockinPagination
from platform_core.api.serializers import StrictSerializer

from .automation import AutomationConflict, available_types, control_job, enqueue_job
from .automation_tasks import TASKS, AutomationBlocked, sheet_task_context
from .models import AutomationJob, SubjectReference
from .references import searchable_references


class JobConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "automation_conflict"


class JobFilters(StrictSerializer):
    job_type = serializers.CharField(max_length=40, required=False)
    status = serializers.ChoiceField(choices=AutomationJob.Status.choices, required=False)
    subject = serializers.UUIDField(required=False)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)


class QueueJob(StrictSerializer):
    job_type = serializers.CharField(max_length=40)
    sheet_id = serializers.UUIDField()
    normal_count = serializers.IntegerField(min_value=0, max_value=MAX_IMPORT_QUESTIONS)
    idempotency_key = serializers.UUIDField()


class QueueOperationalCheck(StrictSerializer):
    job_type = serializers.CharField(max_length=40)
    idempotency_key = serializers.UUIDField()


class JobControl(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(choices=("retry", "cancel"))


def job_data(job: AutomationJob, *, detail: bool = False) -> dict[str, Any]:
    sheet = job.learning_object
    subject = job.academic_subject
    version = sheet.current_version if sheet else None
    data: dict[str, Any] = {
        "id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "revision": job.revision,
        "progress": job.progress,
        "priority": job.priority,
        "subject_id": job.academic_subject_id,
        "subject_title": subject.title if subject else "",
        "sheet_id": job.learning_object_id,
        "sheet_title": version.title if version else "",
        "created_at": job.created_at,
        "started_at": job.started_at,
        "updated_at": job.updated_at,
        "completed_at": job.completed_at,
        "error_code": job.error_code,
        "error_message": job.error_message,
        "requested_by": job.requested_by_id,
    }
    if detail:
        data["attempts"] = list(
            job.attempts.values(
                "attempt_number", "started_at", "finished_at", "result", "error_details"
            )
        )
        output = job.output_manifest
        if job.job_type == "question_package" and (sections := output.get("reference_sections")):
            available = searchable_references(
                SubjectReference.objects.filter(
                    subject_id=job.academic_subject_id,
                    id__in=[section["reference_id"] for section in sections],
                )
            ).values_list("id", flat=True)
            available_ids = {str(reference_id) for reference_id in available}
            output = {
                **output,
                "reference_sections": [
                    section for section in sections if section["reference_id"] in available_ids
                ],
            }
        data["output"] = output
    return data


class AutomationView(APIView):
    permission_classes = [IsAuthenticated]

    def visible_jobs(self, request: Request) -> QuerySet[AutomationJob]:
        visible = available_types(cast(User, request.user))
        if not visible:
            raise PermissionDenied("An automation task permission is required.")
        return AutomationJob.objects.filter(job_type__in=visible).select_related(
            "academic_subject", "learning_object__current_version"
        )


class AutomationJobListView(AutomationView):
    def get(self, request: Request) -> Response:
        jobs = self.visible_jobs(request)
        filters = JobFilters(
            data={
                key: value
                for key, value in request.query_params.items()
                if key not in {"page", "page_size"}
            }
        )
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        if data.get("date_from") and data.get("date_to") and data["date_from"] > data["date_to"]:
            raise RequestRejected("The date range is reversed.")
        for name, lookup in (
            ("job_type", "job_type"),
            ("subject", "academic_subject_id"),
            ("date_from", "created_at__date__gte"),
            ("date_to", "created_at__date__lte"),
        ):
            if name in data:
                jobs = jobs.filter(**{lookup: data[name]})
        counts = dict(jobs.order_by().values_list("status").annotate(total=Count("id")))
        if "status" in data:
            jobs = jobs.filter(status=data["status"])
        pager = LockinPagination()
        rows = pager.paginate_queryset(jobs, request)
        response = pager.get_paginated_response([job_data(job) for job in rows or []])
        actor = cast(User, request.user)
        writable = available_types(actor, write=True)
        response.data["status_counts"] = counts
        response.data["task_types"] = [
            {
                "id": key,
                "label": TASKS[key].label,
                "can_run": key in writable,
                "area": TASKS[key].area,
            }
            for key in available_types(actor)
        ]
        return response

    def post(self, request: Request) -> Response:
        actor = cast(User, request.user)
        if not isinstance(request.data, dict):
            raise RequestRejected("Provide one automation job object.")
        initial = QueueOperationalCheck(
            data={key: request.data.get(key) for key in ("job_type", "idempotency_key")}
        )
        initial.is_valid(raise_exception=True)
        kind = initial.validated_data["job_type"]
        if kind not in available_types(actor, write=True):
            raise PermissionDenied("The required operational permission is not assigned.")
        if TASKS[kind].area:
            check_serializer = QueueOperationalCheck(data=request.data)
            check_serializer.is_valid(raise_exception=True)
            try:
                job, created = enqueue_job(
                    actor=actor,
                    job_type=kind,
                    idempotency_key=check_serializer.validated_data["idempotency_key"],
                    input_manifest={},
                )
            except AutomationConflict as error:
                raise JobConflict(str(error)) from error
            return Response(job_data(job), status=201 if created else 200)
        serializer = QueueJob(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        kind = str(data["job_type"])
        if kind != "question_package":
            raise RequestRejected("Start this task from its administration area.")
        sheet = get_object_or_404(
            LearningObject.objects.select_related("current_version__academic_node"),
            id=data["sheet_id"],
            current_version__content_type=LearningObjectVersion.ContentType.PDF,
            current_version__academic_node__kind=EducationNode.Kind.SUBJECT,
        )
        version = sheet.current_version
        if version is None:
            raise NotFound("The sheet has no current version.")
        existing = AutomationJob.objects.filter(
            requested_by=actor, idempotency_key=data["idempotency_key"]
        ).first()
        normal_count = int(data["normal_count"])
        if existing is not None:
            if (
                existing.job_type != kind
                or existing.learning_object_id != sheet.id
                or existing.input_manifest["normal_count"] != normal_count
            ):
                raise JobConflict("This request key was already used with different inputs.")
            return Response(job_data(existing, detail=True))
        try:
            context = sheet_task_context(sheet, normal_count)
            job, created = enqueue_job(
                actor=actor,
                job_type=kind,
                idempotency_key=data["idempotency_key"],
                subject_id=version.academic_node_id,
                sheet_id=sheet.id,
                input_manifest={
                    "normal_count": normal_count,
                    "sheet_revision": sheet.revision,
                    "settings_revision": context["settings_revision"],
                },
            )
        except AutomationBlocked as error:
            raise RequestRejected(str(error), code=error.code) from error
        except AutomationConflict as error:
            raise JobConflict(str(error)) from error
        return Response(job_data(job, detail=True), status=201 if created else 200)


class AutomationJobDetailView(AutomationView):
    def get(self, request: Request, job_id: UUID) -> Response:
        job = get_object_or_404(self.visible_jobs(request), id=job_id)
        return Response(job_data(job, detail=True))

    def post(self, request: Request, job_id: UUID) -> Response:
        job = get_object_or_404(self.visible_jobs(request), id=job_id)
        actor = cast(User, request.user)
        if job.job_type not in available_types(actor, write=True):
            raise PermissionDenied("The required operational permission is not assigned.")
        serializer = JobControl(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            updated = control_job(
                actor=actor,
                job_id=job_id,
                revision=serializer.validated_data["expected_revision"],
                action=serializer.validated_data["action"],
            )
        except AutomationJob.DoesNotExist as error:
            raise NotFound() from error
        except AutomationConflict as error:
            raise JobConflict(str(error)) from error
        return Response(job_data(updated, detail=True))

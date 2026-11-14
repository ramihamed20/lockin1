from typing import Any, cast
from uuid import UUID

from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils.http import content_disposition_header
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.education.models import EducationNode
from apps.files.models import ManagedFile
from apps.files.services import FileValidationError, managed_file_delivery_ready
from platform_core.api.pagination import LockinPagination
from platform_core.api.serializers import StrictSerializer
from platform_core.storage import ManagedObjectUnavailable, open_managed_object

from .automation import AutomationConflict, enqueue_job
from .automation_views import JobConflict
from .catalog import Capability
from .models import SubjectReference
from .permissions import HasOperationalCapability
from .references import (
    ReferenceConflict,
    current_references,
    delete_reference_upload,
    filter_references,
    search_pages,
    store_reference,
)


class ReferenceFilters(StrictSerializer):
    q = serializers.CharField(max_length=160, required=False, allow_blank=True)
    kind = serializers.ChoiceField(choices=SubjectReference.Kind.choices, required=False)
    tag = serializers.CharField(max_length=60, required=False, allow_blank=True)


class ReferenceUpload(StrictSerializer):
    title = serializers.CharField(max_length=220)
    kind = serializers.ChoiceField(choices=SubjectReference.Kind.choices)
    tags = serializers.CharField(max_length=600, allow_blank=True, default="")
    pdf = serializers.FileField()
    previous_id = serializers.UUIDField(required=False)
    expected_revision = serializers.IntegerField(min_value=1, required=False)
    idempotency_key = serializers.UUIDField()

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if ("previous_id" in attrs) != ("expected_revision" in attrs):
            raise serializers.ValidationError("Provide both the previous ID and its revision.")
        tags = list(
            dict.fromkeys(tag.strip().casefold() for tag in attrs["tags"].split(",") if tag.strip())
        )
        if len(tags) > 12 or any(len(tag) > 60 for tag in tags):
            raise serializers.ValidationError(
                {"tags": ["Use up to 12 tags of 60 characters each."]}
            )
        attrs["tags"] = tags
        return attrs


def reference_data(reference: SubjectReference) -> dict[str, Any]:
    return {
        "id": reference.id,
        "title": reference.title,
        "kind": reference.kind,
        "tags": reference.tags,
        "revision": reference.revision,
        "checksum": reference.checksum,
        "created_at": reference.created_at,
        "indexed_at": reference.indexed_at,
        "page_count": reference.file.pdf_page_count,
        "pdf_available": managed_file_delivery_ready(reference.file),
    }


class ReferenceView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.CONTENT_VIEW


class SubjectReferenceListView(ReferenceView):
    parser_classes = [MultiPartParser]

    def get_permissions(self) -> list[Any]:
        if self.request.method == "POST":
            self.required_capability = Capability.CONTENT_MANAGE
        return list(super().get_permissions())

    def get(self, request: Request, subject_id: UUID) -> Response:
        get_object_or_404(EducationNode, id=subject_id, kind=EducationNode.Kind.SUBJECT)
        filters = ReferenceFilters(
            data={
                key: value
                for key, value in request.query_params.items()
                if key not in {"page", "page_size"}
            }
        )
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        references = current_references(subject_id=subject_id).select_related("file")
        if data.get("kind"):
            references = references.filter(kind=data["kind"])
        if data.get("tag"):
            references = references.filter(tags__icontains=data["tag"].casefold())
        query = data.get("q", "")
        matches = []
        if query:
            matches = [
                {
                    "reference_id": row.reference_id,
                    "title": row.reference.title,
                    "page": row.page,
                    "excerpt": row.text[:500],
                }
                for row in search_pages(references, query)[:12]
            ]
            references = filter_references(references, query)
        pager = LockinPagination()
        rows = pager.paginate_queryset(references, request)
        response = pager.get_paginated_response([reference_data(row) for row in rows or []])
        response.data["matches"] = matches
        return response

    def post(self, request: Request, subject_id: UUID) -> Response:
        subject = get_object_or_404(EducationNode, id=subject_id, kind=EducationNode.Kind.SUBJECT)
        serializer = ReferenceUpload(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        actor = cast(User, request.user)
        upload = data["pdf"]
        if not isinstance(upload, UploadedFile):
            raise ValidationError({"pdf": ["Choose a PDF file."]})
        managed: ManagedFile | None = None
        try:
            with transaction.atomic():
                reference, managed = store_reference(
                    actor=actor,
                    subject=subject,
                    upload=upload,
                    title=data["title"],
                    kind=data["kind"],
                    tags=data["tags"],
                    previous_id=data.get("previous_id"),
                    expected_revision=data.get("expected_revision"),
                )
                job, _ = enqueue_job(
                    actor=actor,
                    job_type="reference_index",
                    idempotency_key=data["idempotency_key"],
                    subject_id=subject.id,
                    input_manifest={"reference_id": str(reference.id)},
                )
        except FileValidationError as error:
            raise ValidationError({"pdf": [str(error)]}) from error
        except (AutomationConflict, ReferenceConflict) as error:
            if managed is not None:
                delete_reference_upload(managed)
            raise JobConflict(str(error)) from error
        except Exception:
            if managed is not None:
                delete_reference_upload(managed)
            raise
        return Response({**reference_data(reference), "job_id": job.id}, status=201)


class SubjectReferenceHistoryView(ReferenceView):
    def get(self, request: Request, subject_id: UUID, reference_id: UUID) -> Response:
        reference = get_object_or_404(SubjectReference, pk=reference_id, subject_id=subject_id)
        history = (
            SubjectReference.objects.filter(subject_id=subject_id, family_id=reference.family_id)
            .select_related("file")
            .order_by("-revision")
        )
        pager = LockinPagination()
        rows = pager.paginate_queryset(history, request)
        return pager.get_paginated_response([reference_data(row) for row in rows or []])


class SubjectReferencePDFView(ReferenceView):
    def get(self, request: Request, subject_id: UUID, reference_id: UUID) -> StreamingHttpResponse:
        reference = get_object_or_404(
            SubjectReference.objects.select_related("file"), pk=reference_id, subject_id=subject_id
        )
        if not managed_file_delivery_ready(reference.file):
            raise NotFound("This reference PDF is unavailable.")
        try:
            stored = open_managed_object(reference.file.blob)
            chunks = stored.stream()
        except ManagedObjectUnavailable as error:
            raise NotFound("This reference PDF is unavailable.") from error
        response = StreamingHttpResponse(chunks, content_type="application/pdf")
        response["Content-Disposition"] = (
            content_disposition_header(True, reference.file.original_name) or "attachment"
        )
        response["Cache-Control"] = "private, no-store"
        return response

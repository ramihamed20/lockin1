import re
from uuid import UUID

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.http import HttpResponse, StreamingHttpResponse
from django.http.response import HttpResponseBase
from django.shortcuts import get_object_or_404
from django.utils.http import content_disposition_header
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability
from apps.content.policies import can_access_managed_file
from apps.education.permissions import IsCreatorOrAdministrator
from platform_core.storage import ManagedObjectUnavailable, open_managed_object

from .models import ManagedFile
from .serializers import (
    FileScanDecisionSerializer,
    FileUploadSerializer,
    ManagedFileSerializer,
)
from .services import (
    FileValidationError,
    ScanDecisionError,
    create_managed_file,
    record_operator_scan_decision,
)


class ManagedFileUploadView(APIView):
    permission_classes = [IsCreatorOrAdministrator]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request: Request) -> Response:
        serializer = FileUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not isinstance(user, User):
            raise ValidationError("An authenticated account is required.")
        upload = serializer.validated_data["file"]
        if not isinstance(upload, UploadedFile):
            raise ValidationError({"file": ["A valid uploaded file is required."]})
        try:
            managed_file = create_managed_file(
                owner=user,
                upload=upload,
                kind=str(serializer.validated_data["kind"]),
            )
        except FileValidationError as error:
            raise ValidationError({"file": [str(error)]}) from error
        return Response(ManagedFileSerializer(managed_file).data, status=status.HTTP_201_CREATED)


class ManagedFileScanDecisionView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.CONTENT_MANAGE

    def post(self, request: Request, file_id: UUID) -> Response:
        serializer = FileScanDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actor = request.user
        if not isinstance(actor, User):
            raise PermissionDenied()
        try:
            managed_file = record_operator_scan_decision(
                actor=actor,
                managed_file_id=file_id,
                decision=str(serializer.validated_data["decision"]),  # type: ignore[arg-type]
                reason=str(serializer.validated_data["reason"]),
            )
        except ManagedFile.DoesNotExist as error:
            raise NotFound("File not found.") from error
        except ScanDecisionError as error:
            raise ValidationError({"decision": [str(error)]}) from error
        return Response(ManagedFileSerializer(managed_file).data)


RANGE_PATTERN = re.compile(r"bytes=(\d*)-(\d*)$")
STREAM_CHUNK_SIZE = 64 * 1024


def _byte_range(value: str, size: int) -> tuple[int, int] | None:
    match = RANGE_PATTERN.fullmatch(value.strip())
    if match is None:
        return None
    start_text, end_text = match.groups()
    if not start_text and not end_text:
        return None
    if start_text:
        start = int(start_text)
        end = int(end_text) if end_text else size - 1
    else:
        suffix_length = int(end_text)
        if suffix_length <= 0:
            return None
        start = max(0, size - suffix_length)
        end = size - 1
    if start >= size or start > end:
        return None
    return start, min(end, size - 1)


class ManagedFileDeliveryView(APIView):
    def get(self, request: Request, file_id: UUID, disposition: str) -> HttpResponseBase:
        if disposition not in {"view", "download"}:
            raise NotFound("File not found.")
        managed_file = get_object_or_404(ManagedFile, id=file_id)
        user = request.user
        if not isinstance(user, User):
            raise PermissionDenied()
        is_download = disposition == "download"
        if not can_access_managed_file(
            user=user,
            managed_file=managed_file,
            download=is_download,
        ):
            raise NotFound("File not found.")
        if managed_file.validation_status != ManagedFile.ValidationStatus.READY:
            raise NotFound("File not found.")
        blocked_scan_states = {
            ManagedFile.ScanStatus.QUARANTINED,
            ManagedFile.ScanStatus.FAILED,
        }
        if managed_file.scan_status in blocked_scan_states or (
            settings.CONTENT_REQUIRE_CLEAN_SCAN
            and managed_file.scan_status != ManagedFile.ScanStatus.CLEAN
        ):
            raise NotFound("File not found.")
        try:
            stored_object = open_managed_object(managed_file.blob)
        except ManagedObjectUnavailable as error:
            raise NotFound("File not found.") from error

        size = managed_file.size_bytes
        range_header = request.headers.get("Range")
        response: HttpResponseBase
        if range_header and not is_download:
            selected_range = _byte_range(range_header, size)
            if selected_range is None:
                stored_object.close()
                response = HttpResponse(status=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE)
                response["Content-Range"] = f"bytes */{size}"
                return response
            start, end = selected_range
            length = end - start + 1
            response = StreamingHttpResponse(
                stored_object.stream(start=start, length=length, chunk_size=STREAM_CHUNK_SIZE),
                status=status.HTTP_206_PARTIAL_CONTENT,
                content_type=managed_file.content_type,
            )
            response["Content-Range"] = f"bytes {start}-{end}/{size}"
            response["Content-Length"] = str(length)
        else:
            # Streaming the whole object keeps object storage from staging a
            # complete copy in the container before the first byte is sent.
            response = StreamingHttpResponse(
                stored_object.stream(chunk_size=STREAM_CHUNK_SIZE),
                content_type=managed_file.content_type,
            )
            response["Content-Length"] = str(size)
        response["Accept-Ranges"] = "bytes"
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        content_disposition = content_disposition_header(
            as_attachment=is_download,
            filename=managed_file.original_name,
        )
        if content_disposition is not None:
            response["Content-Disposition"] = content_disposition
        return response

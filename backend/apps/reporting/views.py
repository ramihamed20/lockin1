from typing import Any, cast

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability
from platform_core.api.exceptions import RequestRejected

from .serializers import (
    ReportExecuteSerializer,
    ReportExportSerializer,
    ReportPreviewRequestSerializer,
)
from .services import ReportingError, execute_report, preview_report, report_catalog_for


def _user(request: Request) -> User:
    return cast(User, request.user)


class ReportCatalogView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.REPORTS_EXPORT

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request: Request) -> Response:
        return Response({"results": report_catalog_for(user=_user(request))})


class ReportPreviewView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.REPORTS_EXPORT

    @extend_schema(request=ReportPreviewRequestSerializer, responses=ReportExportSerializer)
    def post(self, request: Request) -> Response:
        serializer = ReportPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        try:
            export, token = preview_report(
                user=_user(request), report_code=data["report_code"], filters=data["filters"], output_format=data["output_format"]
            )
        except ReportingError as error:
            raise RequestRejected(str(error), code="report_preview_rejected") from error
        payload = ReportExportSerializer(export).data
        payload["confirmation_token"] = token
        return Response(payload, status=201)


class ReportExecuteView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.REPORTS_EXPORT

    @extend_schema(
        request=ReportExecuteSerializer,
        responses={(200, "application/octet-stream"): OpenApiTypes.BINARY},
    )
    def post(self, request: Request, export_id: str) -> HttpResponse:
        serializer = ReportExecuteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = cast(dict[str, Any], serializer.validated_data)["confirmation_token"]
        try:
            export, content, content_type, extension = execute_report(
                export_id=export_id,
                confirmation_token=token,
                user=_user(request),
                source="operations.api",
            )
        except ReportingError as error:
            raise RequestRejected(str(error), code="report_execution_rejected") from error
        response = HttpResponse(content, content_type=content_type)
        response["Content-Disposition"] = (
            f'attachment; filename="{export.report_code}-{export.id}.{extension}"'
        )
        response["X-Content-Type-Options"] = "nosniff"
        return response

from typing import Any
from uuid import UUID

from rest_framework import serializers, status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from platform_core.api.exceptions import RequestRejected
from platform_core.api.serializers import StrictSerializer

from .sheet_summaries import (
    MAX_PER_SHEET,
    SheetSummaryConflict,
    SheetSummaryError,
    SummaryChanges,
    create_summary,
    delete_summary,
    owned_summaries,
    summary_payload,
    update_summary,
)
from .views import _catalog_document_by_id


class SummaryCreateSerializer(StrictSerializer):
    title = serializers.CharField(max_length=240, trim_whitespace=True)
    mode = serializers.CharField(max_length=16)
    color = serializers.CharField(max_length=16, default="blue")


class SummaryUpdateSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1, required=False)
    title = serializers.CharField(max_length=240, trim_whitespace=True, required=False)
    color = serializers.CharField(max_length=16, required=False)
    visible = serializers.BooleanField(required=False)
    finished = serializers.BooleanField(required=False)
    pages = serializers.DictField(required=False)


class SheetSummaryConflictError(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This summary changed on another device. Reload it first."
    default_code = "sheet_summary_conflict"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _rejected(error: SheetSummaryError) -> Exception:
    if error.code == "not_found":
        return NotFound(str(error))
    return RequestRejected(str(error), code=error.code)


class SheetSummaryCollectionView(APIView):
    """Every summary the student has written, for the Materials page."""

    def get(self, request: Request) -> Response:
        rows = owned_summaries(user=_user(request))
        return Response({"results": [summary_payload(row) for row in rows]})


class DocumentSummaryCollectionView(APIView):
    def get(self, request: Request, document_id: UUID) -> Response:
        user = _user(request)
        document = _catalog_document_by_id(user=user, document_id=document_id)
        rows = owned_summaries(user=user, document=document)
        return Response(
            {"results": [summary_payload(row) for row in rows], "max_per_sheet": MAX_PER_SHEET}
        )

    def post(self, request: Request, document_id: UUID) -> Response:
        user = _user(request)
        document = _catalog_document_by_id(user=user, document_id=document_id)
        serializer = SummaryCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            summary = create_summary(
                user=user,
                document=document,
                title=data["title"],
                mode=data["mode"],
                color=data["color"],
            )
        except SheetSummaryError as error:
            raise _rejected(error) from error
        return Response({"summary": summary_payload(summary)}, status=status.HTTP_201_CREATED)


class SheetSummaryDetailView(APIView):
    def patch(self, request: Request, summary_id: UUID) -> Response:
        user = _user(request)
        serializer = SummaryUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data: dict[str, Any] = dict(serializer.validated_data)
        try:
            summary = update_summary(
                user=user,
                summary_id=summary_id,
                changes=SummaryChanges(
                    expected_revision=data.get("expected_revision"),
                    title=data.get("title"),
                    color=data.get("color"),
                    visible=data.get("visible"),
                    finished=data.get("finished"),
                    pages=data.get("pages"),
                ),
            )
        except SheetSummaryConflict as error:
            raise SheetSummaryConflictError() from error
        except SheetSummaryError as error:
            raise _rejected(error) from error
        return Response({"summary": summary_payload(summary)})

    def delete(self, request: Request, summary_id: UUID) -> Response:
        if not delete_summary(user=_user(request), summary_id=summary_id):
            raise NotFound("Summary not found.")
        return Response(status=status.HTTP_204_NO_CONTENT)

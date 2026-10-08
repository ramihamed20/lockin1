from typing import Any
from uuid import UUID

from django.core.files.uploadedfile import UploadedFile
from rest_framework import serializers, status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.focus.selectors import annotation_collection_revision
from platform_core.api.exceptions import RequestRejected
from platform_core.api.serializers import StrictSerializer

from .models import CatalogSubject, PersonalSheet
from .personal_sheets import (
    TITLE_MAX_LENGTH,
    PersonalSheetError,
    PersonalWorkspaceConflict,
    PersonalWorkspaceKeyReused,
    account_sheet_count,
    add_personal_sheet,
    delete_personal_sheets,
    delivery_status,
    max_sheet_bytes,
    max_sheets_per_account,
    owned_sheet,
    owned_sheets,
    save_sheet_workspace,
    sheet_workspace,
    visible_subject,
    workspace_revision,
)


class PersonalSheetUploadSerializer(StrictSerializer):
    title = serializers.CharField(max_length=TITLE_MAX_LENGTH * 2, trim_whitespace=True)
    file = serializers.FileField(write_only=True)


class PersonalWorkspaceSaveSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)
    idempotency_key = serializers.UUIDField()
    state = serializers.DictField()


class PersonalWorkspaceConflictError(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Workspace changed. Reload and merge before saving."
    default_code = "catalog_workspace_conflict"


class PersonalSheetDeleteSerializer(StrictSerializer):
    ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=100)


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _subject_payload(subject: CatalogSubject) -> dict[str, Any]:
    return {"slug": subject.material_slug, "title": subject.title}


def _sheet_payload(sheet: PersonalSheet) -> dict[str, Any]:
    managed_file = sheet.managed_file
    sheet_status = delivery_status(managed_file)
    return {
        "id": str(sheet.id),
        "title": sheet.title,
        "page_count": sheet.page_count,
        "size_bytes": managed_file.size_bytes,
        "created_at": sheet.created_at.isoformat(),
        "status": sheet_status,
        "view_url": f"/api/v1/files/{managed_file.id}/view" if sheet_status == "ready" else None,
        "active_study": {"status": sheet.active_study_status},
    }


def _limits_payload(owner: User) -> dict[str, int]:
    used = account_sheet_count(owner)
    maximum = max_sheets_per_account()
    return {
        "max_sheets": maximum,
        "max_file_bytes": max_sheet_bytes(),
        "used": used,
        "remaining": max(0, maximum - used),
    }


def _rejected(error: PersonalSheetError) -> RequestRejected:
    return RequestRejected(str(error), code=error.code)


class PersonalSheetCollectionView(APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _subject(self, user: User, material_slug: str) -> CatalogSubject:
        subject = visible_subject(user=user, material_slug=material_slug)
        if subject is None:
            raise NotFound("Subject not found.")
        return subject

    def get(self, request: Request, material_slug: str) -> Response:
        user = _user(request)
        subject = self._subject(user, material_slug)
        sheets = owned_sheets(owner=user, subject=subject)
        return Response(
            {
                "subject": _subject_payload(subject),
                "results": [_sheet_payload(sheet) for sheet in sheets],
                "limits": _limits_payload(user),
            }
        )

    def post(self, request: Request, material_slug: str) -> Response:
        user = _user(request)
        subject = self._subject(user, material_slug)
        serializer = PersonalSheetUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["file"]
        if not isinstance(upload, UploadedFile):
            raise RequestRejected("Choose a PDF file.", code="personal_sheet_invalid")
        try:
            sheet = add_personal_sheet(
                owner=user,
                subject=subject,
                title=serializer.validated_data["title"],
                upload=upload,
            )
        except PersonalSheetError as error:
            raise _rejected(error) from error
        return Response(
            {"sheet": _sheet_payload(sheet), "limits": _limits_payload(user)},
            status=status.HTTP_201_CREATED,
        )


class PersonalSheetDetailView(APIView):
    def get(self, request: Request, sheet_id: UUID) -> Response:
        user = _user(request)
        sheet = (
            PersonalSheet.objects.select_related("managed_file", "subject")
            .filter(id=sheet_id, owner=user)
            .first()
        )
        if sheet is None:
            raise NotFound("Sheet not found.")
        return Response(
            {"sheet": _sheet_payload(sheet), "subject": _subject_payload(sheet.subject)}
        )


class PersonalSheetDeleteView(APIView):
    def post(self, request: Request) -> Response:
        user = _user(request)
        serializer = PersonalSheetDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        deleted = delete_personal_sheets(owner=user, sheet_ids=serializer.validated_data["ids"])
        return Response({"deleted": deleted, "limits": _limits_payload(user)})


class PersonalSheetWorkspaceView(APIView):
    """Reader state for one of the student's own sheets, in the catalog shape.

    The response matches a catalog sheet's workspace so the reader's sync runs
    unchanged. Its marks are stored in the Focus annotation collection keyed by
    the sheet id, which is also what `document_version_id` names here.
    """

    def _sheet(self, request: Request, sheet_id: UUID) -> tuple[User, PersonalSheet]:
        user = _user(request)
        sheet = owned_sheet(owner=user, sheet_id=sheet_id)
        if sheet is None:
            raise NotFound("Sheet not found.")
        return user, sheet

    def _identity(self, user: User, sheet: PersonalSheet) -> dict[str, Any]:
        return {
            "collection_revision": annotation_collection_revision(
                user_id=user.id, document_id=sheet.id
            ),
            "document_version_id": str(sheet.id),
            "checksum_sha256": sheet.managed_file.checksum_sha256,
        }

    def get(self, request: Request, sheet_id: UUID) -> Response:
        user, sheet = self._sheet(request, sheet_id)
        if request.query_params.get("probe") == "1":
            return Response({"revision": workspace_revision(sheet), **self._identity(user, sheet)})
        workspace = sheet_workspace(sheet)
        return Response(
            {
                "revision": workspace.revision,
                "state": workspace.state,
                **self._identity(user, sheet),
            }
        )

    def patch(self, request: Request, sheet_id: UUID) -> Response:
        _, sheet = self._sheet(request, sheet_id)
        serializer = PersonalWorkspaceSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            saved = save_sheet_workspace(
                sheet=sheet,
                expected_revision=data["expected_revision"],
                idempotency_key=data["idempotency_key"],
                state=dict(data["state"]),
            )
        except PersonalWorkspaceConflict as error:
            raise PersonalWorkspaceConflictError() from error
        except PersonalWorkspaceKeyReused as error:
            raise RequestRejected(
                "The idempotency key was reused for another request.",
                code="idempotency_key_reused",
            ) from error
        return Response({**saved.payload, "replayed": saved.replayed})

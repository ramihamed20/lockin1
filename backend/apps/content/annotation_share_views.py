import json
from typing import Any
from uuid import UUID

from django.core.files.uploadedfile import UploadedFile
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from platform_core.api.exceptions import RequestRejected
from platform_core.api.serializers import StrictSerializer

from . import annotation_shares as shares
from .models import CatalogDocument, SharedAnnotationImport, SharedAnnotationSet
from .views import _catalog_document_by_id


class PublishSerializer(StrictSerializer):
    display_name = serializers.CharField(
        max_length=shares.NAME_MAX_LENGTH * 2, required=False, allow_blank=True, default=""
    )
    anonymous = serializers.BooleanField(required=False, default=False)
    note = serializers.CharField(
        max_length=shares.NOTE_MAX_LENGTH * 2, required=False, allow_blank=True, default=""
    )
    based_on = serializers.UUIDField(required=False, allow_null=True, default=None)
    snapshot = serializers.FileField(write_only=True)


class ReportSerializer(StrictSerializer):
    reason = serializers.CharField(
        max_length=shares.REASON_MAX_LENGTH * 2, required=False, allow_blank=True, default=""
    )


class ImportSerializer(StrictSerializer):
    # None copies every page; a list copies just those pages (PDF page numbers
    # and the ids of added pages).
    pages = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        allow_null=True,
        max_length=2000,
        default=None,
    )


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _rejected(error: shares.AnnotationShareError) -> RequestRejected:
    return RequestRejected(str(error), code=error.code)


def _item(
    shared: SharedAnnotationSet,
    *,
    user: User,
    liked: set[Any],
    imports: dict[Any, SharedAnnotationImport],
    moderator: bool,
) -> dict[str, Any]:
    mine = shared.owner_id == user.id
    record = imports.get(shared.id)
    payload: dict[str, Any] = {
        "id": str(shared.id),
        "author": shares.author_label(shared),
        "anonymous": shared.is_anonymous,
        "mine": mine,
        "note": shared.note,
        "likes": shared.like_count,
        "liked": shared.id in liked,
        "marks": shared.mark_count,
        "pages": len(shared.marked_pages),
        "version": shared.version,
        "size_bytes": shared.size_bytes,
        "updated_at": shared.updated_at.isoformat(),
        "based_on": shared.based_on_name,
        "copied_version": record.imported_version if record else None,
    }
    if moderator:
        # Only a moderator sees who stands behind an anonymous share.
        payload["owner_email"] = shared.owner.email
        payload["reports"] = shared.report_count
    return payload


def _document(request: Request, document_id: UUID) -> tuple[User, CatalogDocument]:
    user = _user(request)
    return user, _catalog_document_by_id(user=user, document_id=document_id)


class AnnotationShareCollectionView(APIView):
    """List the shares on one sheet (most liked first) and publish your own."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request: Request, document_id: UUID) -> Response:
        user, document = _document(request, document_id)
        moderator = shares.can_moderate(user)
        queryset = shares.live_sets(document).defer("snapshot").select_related("owner")
        query = str(request.query_params.get("q", "")).strip()[:80]
        if query:
            queryset = queryset.filter(display_name__icontains=query)
        results = list(queryset.order_by("-like_count", "-updated_at", "id")[:100])
        ids = [item.id for item in results]
        liked = set(
            SharedAnnotationSet.objects.filter(id__in=ids, likes__user=user).values_list(
                "id", flat=True
            )
        )
        imports = {
            record.shared_set_id: record
            for record in SharedAnnotationImport.objects.filter(user=user, shared_set_id__in=ids)
        }
        mine = shares.own_set(owner=user, document=document)
        return Response(
            {
                "results": [
                    _item(item, user=user, liked=liked, imports=imports, moderator=moderator)
                    for item in results
                ],
                "mine_id": str(mine.id) if mine else None,
                "limits": {
                    "max_bytes": shares.max_share_bytes(),
                    "copies_used": shares.copies_in_use(user),
                    "copies_max": shares.max_copies_per_account(),
                },
                "moderator": moderator,
            }
        )

    def post(self, request: Request, document_id: UUID) -> Response:
        user, document = _document(request, document_id)
        serializer = PublishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        upload = data["snapshot"]
        if not isinstance(upload, UploadedFile):
            raise RequestRejected("The marks could not be read.", code="annotation_share_invalid")
        if upload.size is not None and upload.size > shares.max_share_bytes() + 1024 * 1024:
            raise _rejected(
                shares.AnnotationShareTooLarge(
                    f"Your marks are larger than {shares.max_share_bytes() // (1024 * 1024)} MB."
                )
            )
        try:
            raw = json.loads(upload.read().decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as error:
            raise RequestRejected(
                "The marks could not be read.", code="annotation_share_invalid"
            ) from error
        try:
            shared, created = shares.publish(
                owner=user,
                document=document,
                display_name=data["display_name"],
                anonymous=data["anonymous"],
                note=data["note"],
                raw_snapshot=raw,
                based_on_id=data["based_on"],
            )
        except shares.AnnotationShareError as error:
            raise _rejected(error) from error
        return Response(
            {
                "id": str(shared.id),
                "version": shared.version,
                "marks": shared.mark_count,
                "pages": len(shared.marked_pages),
                "created": created,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class AnnotationShareNoticesView(APIView):
    def get(self, request: Request, document_id: UUID) -> Response:
        user, document = _document(request, document_id)
        return Response(
            {
                "results": [
                    {
                        "kind": notice.kind,
                        "id": str(notice.share_id),
                        "author": notice.author,
                        "version": notice.version,
                    }
                    for notice in shares.notices(user=user, document=document)
                ]
            }
        )


class AnnotationCopiesView(APIView):
    """The student's own copies of other students' marks on one sheet."""

    def get(self, request: Request, document_id: UUID) -> Response:
        user, document = _document(request, document_id)
        return Response(
            {
                "results": [
                    {
                        "id": str(sheet.id),
                        "title": sheet.title,
                        "author": sheet.copy_author,
                        "share_id": str(sheet.source_set_id) if sheet.source_set_id else "",
                        "created_at": sheet.created_at.isoformat(),
                    }
                    for sheet in shares.copies_of(user=user, document=document)
                ]
            }
        )


class _ShareView(APIView):
    def _share(
        self, request: Request, document_id: UUID, share_id: UUID
    ) -> tuple[User, CatalogDocument, SharedAnnotationSet]:
        user, document = _document(request, document_id)
        try:
            return user, document, shares.get_live_set(document=document, set_id=share_id)
        except shares.AnnotationShareNotFound as error:
            raise NotFound("These marks are no longer shared.") from error


class AnnotationShareDetailView(_ShareView):
    def get(self, request: Request, document_id: UUID, share_id: UUID) -> Response:
        user, _, shared = self._share(request, document_id, share_id)
        return Response(
            {
                "id": str(shared.id),
                "author": shares.author_label(shared),
                "note": shared.note,
                "version": shared.version,
                "marks": shared.mark_count,
                "pages": shared.marked_pages,
                "mine": shared.owner_id == user.id,
            }
        )

    def delete(self, request: Request, document_id: UUID, share_id: UUID) -> Response:
        user, _, shared = self._share(request, document_id, share_id)
        if shared.owner_id != user.id and not shares.can_moderate(user):
            raise PermissionDenied("Only the student who shared these marks can remove them.")
        shares.withdraw(shared=shared)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AnnotationShareLikeView(_ShareView):
    def put(self, request: Request, document_id: UUID, share_id: UUID) -> Response:
        user, _, shared = self._share(request, document_id, share_id)
        return Response(
            {"liked": True, "likes": shares.set_like(shared=shared, user=user, liked=True)}
        )

    def delete(self, request: Request, document_id: UUID, share_id: UUID) -> Response:
        user, _, shared = self._share(request, document_id, share_id)
        return Response(
            {"liked": False, "likes": shares.set_like(shared=shared, user=user, liked=False)}
        )


class AnnotationShareReportView(_ShareView):
    def post(self, request: Request, document_id: UUID, share_id: UUID) -> Response:
        user, _, shared = self._share(request, document_id, share_id)
        if shared.owner_id == user.id:
            raise RequestRejected("You cannot report your own marks.", code="annotation_report_own")
        serializer = ReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        shares.report(shared=shared, reporter=user, reason=serializer.validated_data["reason"])
        return Response({"reported": True}, status=status.HTTP_201_CREATED)


class AnnotationShareImportView(_ShareView):
    def post(self, request: Request, document_id: UUID, share_id: UUID) -> Response:
        user, document, shared = self._share(request, document_id, share_id)
        serializer = ImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        pages = serializer.validated_data["pages"]
        try:
            sheet = shares.import_share(
                user=user,
                document=document,
                shared=shared,
                include=None if pages is None else set(pages),
            )
        except shares.AnnotationShareNotFound as error:
            raise NotFound("This subject is not available to you.") from error
        except shares.AnnotationShareError as error:
            raise _rejected(error) from error
        return Response(
            {
                "sheet_id": str(sheet.id),
                "subject": sheet.subject.material_slug,
                "title": sheet.title,
            },
            status=status.HTTP_201_CREATED,
        )


class AnnotationShareDismissView(_ShareView):
    def post(self, request: Request, document_id: UUID, share_id: UUID) -> Response:
        user, document = _document(request, document_id)
        shares.dismiss(user=user, share_id=share_id)
        return Response({"dismissed": True})

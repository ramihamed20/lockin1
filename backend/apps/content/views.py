import hashlib
import json
from typing import Any
from uuid import UUID

from django.db import models, transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.education.models import EducationNode
from apps.education.permissions import IsCreatorOrAdministrator
from apps.education.policies import is_content_administrator
from apps.entitlements.services import require_entitlement
from apps.files.models import ManagedFile

from .models import (
    CatalogDocument,
    CatalogSubject,
    CatalogWorkspaceReceipt,
    CatalogWorkspaceSnapshot,
    LearningObject,
)
from .policies import can_view_learning_object
from .selectors import (
    manageable_learning_objects,
    published_learning_object,
    published_learning_objects,
)
from .serializers import (
    LearningObjectUpdateSerializer,
    LearningObjectWriteSerializer,
    ManagementLearningObjectSerializer,
    PublicLearningObjectSerializer,
    RejectActionSerializer,
    RevisionActionSerializer,
    TransferActionSerializer,
)
from .services import (
    ContentConflictError,
    ContentRuleError,
    LearningObjectInput,
    archive_learning_object,
    create_learning_object,
    publish_learning_object,
    reject_learning_object,
    revise_learning_object,
    submit_for_review,
    transfer_learning_object,
)


class ContentConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This content changed. Reload it and try again."
    default_code = "revision_conflict"


class ContentRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "content_rule_rejected"


class CatalogWorkspaceConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Catalog workspace changed. Reload and merge before saving."
    default_code = "catalog_workspace_conflict"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _rule_error(error: ContentRuleError) -> APIException:
    message = str(error)
    lowered = message.lower()
    if lowered.startswith("you cannot") or lowered.startswith("only administrators"):
        return PermissionDenied(message)
    return ContentRejected(message)


def _catalog_document(*, user: User, material_slug: str, sheet_slug: str) -> CatalogDocument:
    require_entitlement(user=user, entitlement_code="focus.workspace")
    try:
        document = CatalogDocument.objects.select_related(
            "version__learning_object", "managed_file"
        ).get(material_slug=material_slug, sheet_slug=sheet_slug, is_active=True)
    except CatalogDocument.DoesNotExist as error:
        raise NotFound("Catalog document not found.") from error
    version = document.version
    if (
        version.content_type != version.ContentType.PDF
        or document.managed_file_id
        not in version.assets.filter(role="primary").values_list("managed_file_id", flat=True)
        or version.learning_object.published_version_id != version.id
        or not can_view_learning_object(user=user, learning_object=version.learning_object)
    ):
        raise PermissionDenied("You cannot access this catalog document.")
    return document


class CatalogDocumentResolveView(APIView):
    def get(self, request: Request, material_slug: str, sheet_slug: str) -> Response:
        document = _catalog_document(
            user=_user(request), material_slug=material_slug, sheet_slug=sheet_slug
        )
        return Response(
            {
                "document": {
                    "id": str(document.id),
                    "document_version_id": str(document.version_id),
                    "file_id": str(document.managed_file_id),
                    "view_url": f"/api/v1/files/{document.managed_file_id}/view",
                }
            }
        )


class CatalogMaterialListView(APIView):
    """The one student-facing Materials directory.

    The response is built from CatalogSubject, not display-name matching or a
    browsed education tree.  The current cohort is the only ordinary-student
    scope; content operators deliberately see every branch for management.
    """

    def get(self, request: Request) -> Response:
        user = _user(request)
        subjects = CatalogSubject.objects.filter(is_active=True).select_related("cohort__program")
        if not is_content_administrator(user):
            cohort = user.cohort
            if cohort is None or not cohort.is_active:
                return Response({"count": 0, "results": []})
            subjects = subjects.filter(cohort_id=cohort.id)
        subjects = subjects.order_by(
            "cohort__program__position", "cohort__position", "position", "title", "id"
        )
        results = []
        for subject in subjects:
            documents = (
                CatalogDocument.objects.filter(
                    material_slug=subject.material_slug,
                    is_active=True,
                    version__academic_node_id=subject.source_node_id,
                    version__learning_object__published_version_id=models.F("version_id"),
                    version__learning_object__archived_at__isnull=True,
                )
                .select_related("version__learning_object__active_study_settings")
                .order_by("version__learning_object__position", "sheet_slug", "id")
            )
            # Third Year is intentionally unavailable until its curriculum is
            # configured.  Keep any real legacy material visible for review;
            # only suppress an empty placeholder branch.
            if subject.cohort.code == "year-3" and not documents.exists():
                continue
            sheets = []
            for number, document in enumerate(documents, start=1):
                version = document.version
                settings = getattr(version.learning_object, "active_study_settings", None)
                page_count = (
                    version.metadata.get("page_count")
                    if isinstance(version.metadata, dict)
                    else None
                )
                sheets.append(
                    {
                        "slug": document.sheet_slug,
                        "number": number,
                        "title": version.title,
                        "summary": version.summary,
                        "pageCount": (
                            page_count if isinstance(page_count, int) and page_count > 0 else None
                        ),
                        "hasActiveStudy": bool(settings and settings.enabled),
                    }
                )
            results.append(
                {
                    "slug": subject.material_slug,
                    "title": subject.title,
                    "sheets": sheets,
                    "cohort": {
                        "program_code": subject.cohort.program.code,
                        "cohort_code": subject.cohort.code,
                        "name": subject.cohort.name_en,
                    },
                }
            )
        return Response({"count": len(results), "results": results})


class CatalogWorkspaceView(APIView):
    def get(self, request: Request, document_id: UUID) -> Response:
        user = _user(request)
        document = _catalog_document_by_id(user=user, document_id=document_id)
        workspace, _ = CatalogWorkspaceSnapshot.objects.get_or_create(user=user, document=document)
        return Response({"revision": workspace.revision, "state": workspace.state})

    def patch(self, request: Request, document_id: UUID) -> Response:
        user = _user(request)
        document = _catalog_document_by_id(user=user, document_id=document_id)
        expected = request.data.get("expected_revision")
        key = request.data.get("idempotency_key")
        state = request.data.get("state")
        if (
            not isinstance(expected, int)
            or expected < 0
            or not isinstance(key, str)
            or not isinstance(state, dict)
        ):
            raise ContentRejected("A revision, idempotency key, and workspace state are required.")
        try:
            key_uuid = UUID(key)
        except ValueError as error:
            raise ContentRejected("The idempotency key is invalid.") from error
        encoded = json.dumps(
            {"expected": expected, "state": state}, sort_keys=True, separators=(",", ":")
        ).encode()
        digest = hashlib.sha256(encoded).hexdigest()
        with transaction.atomic():
            workspace, _ = CatalogWorkspaceSnapshot.objects.select_for_update().get_or_create(
                user=user, document=document
            )
            receipt = CatalogWorkspaceReceipt.objects.filter(
                workspace=workspace, idempotency_key=key_uuid
            ).first()
            if receipt:
                if receipt.request_digest != digest:
                    raise ContentRejected("The idempotency key was reused for another request.")
                return Response({**receipt.response_payload, "replayed": True})
            if workspace.revision != expected:
                raise CatalogWorkspaceConflict()
            workspace.state = state
            workspace.revision += 1
            workspace.save(update_fields=("state", "revision", "updated_at"))
            payload = {"revision": workspace.revision, "state": workspace.state, "replayed": False}
            CatalogWorkspaceReceipt.objects.create(
                workspace=workspace,
                idempotency_key=key_uuid,
                request_digest=digest,
                response_payload=payload,
            )
        return Response(payload)


def _catalog_document_by_id(*, user: User, document_id: UUID) -> CatalogDocument:
    try:
        document = CatalogDocument.objects.get(id=document_id)
    except CatalogDocument.DoesNotExist as error:
        raise NotFound("Catalog document not found.") from error
    return _catalog_document(
        user=user, material_slug=document.material_slug, sheet_slug=document.sheet_slug
    )


def _write_input(*, actor: User, data: dict[str, Any]) -> LearningObjectInput:
    node = get_object_or_404(EducationNode, id=data["academic_node_id"])
    file_id = data.get("primary_file_id")
    primary_file = get_object_or_404(ManagedFile, id=file_id) if file_id is not None else None
    return LearningObjectInput(
        academic_node=node,
        content_type=str(data["content_type"]),
        title=str(data["title"]),
        summary=str(data.get("summary", "")),
        language=str(data.get("language", "en")),
        allow_download=bool(data.get("allow_download", False)),
        metadata=dict(data.get("metadata", {})),
        available_from=data.get("available_from"),
        available_until=data.get("available_until"),
        primary_file=primary_file,
        position=int(data.get("position", 0)),
    )


def _public_context(*, user: User, learning_objects: list[LearningObject]) -> dict[str, object]:
    from apps.progress.models import Bookmark, LearningProgress

    ids = [item.id for item in learning_objects]
    bookmarked_ids = set(
        Bookmark.objects.filter(user=user, learning_object_id__in=ids).values_list(
            "learning_object_id", flat=True
        )
    )
    progress_by_content = {
        progress.learning_object_id: progress
        for progress in LearningProgress.objects.filter(user=user, learning_object_id__in=ids)
    }
    return {"bookmarked_ids": bookmarked_ids, "progress_by_content": progress_by_content}


class PublicLearningObjectListView(ListAPIView[LearningObject]):
    serializer_class = PublicLearningObjectSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        raw_node = self.request.query_params.get("node")
        node_id = None
        if raw_node:
            try:
                node_id = UUID(raw_node)
            except ValueError as error:
                raise NotFound("Education node not found.") from error
        content_type = self.request.query_params.get("content_type") or None
        # Querying another cohort's node must not expose sheet titles, files or
        # question-bearing metadata.  File delivery has its own gate, but the
        # catalogue itself is an access surface too.
        user = _user(self.request)
        candidates = published_learning_objects(node_id=node_id, content_type=content_type)
        allowed_ids = [
            item.id
            for item in candidates
            if can_view_learning_object(user=user, learning_object=item)
        ]
        return candidates.filter(id__in=allowed_ids)

    def get_serializer_context(self) -> dict[str, object]:
        context = super().get_serializer_context()
        page_items = list(getattr(self, "_phase4_page_items", []))
        if page_items:
            context.update(_public_context(user=_user(self.request), learning_objects=page_items))
        return context

    def paginate_queryset(self, queryset):  # type: ignore[no-untyped-def]
        page = super().paginate_queryset(queryset)
        self._phase4_page_items = page or []
        return page


class PublicLearningObjectDetailView(APIView):
    def get(self, request: Request, learning_object_id: UUID) -> Response:
        try:
            learning_object = published_learning_object(learning_object_id=learning_object_id)
        except LearningObject.DoesNotExist as error:
            raise NotFound("Learning content not found.") from error
        if not can_view_learning_object(user=_user(request), learning_object=learning_object):
            raise PermissionDenied("You do not have access to this learning content.")
        context = _public_context(user=_user(request), learning_objects=[learning_object])
        return Response(PublicLearningObjectSerializer(learning_object, context=context).data)


class ManagementLearningObjectListView(ListAPIView[LearningObject]):
    permission_classes = [IsCreatorOrAdministrator]
    serializer_class = ManagementLearningObjectSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        queryset = manageable_learning_objects(user=_user(self.request))
        workflow_status = self.request.query_params.get("status")
        if workflow_status:
            queryset = queryset.filter(workflow_status=workflow_status)
        return queryset

    def post(self, request: Request) -> Response:
        serializer = LearningObjectWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            learning_object = create_learning_object(
                actor=_user(request),
                data=_write_input(actor=_user(request), data=serializer.validated_data),
            )
        except ContentRuleError as error:
            raise _rule_error(error) from error
        return Response(
            ManagementLearningObjectSerializer(learning_object).data,
            status=status.HTTP_201_CREATED,
        )


class ManagementLearningObjectDetailView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def get(self, request: Request, learning_object_id: UUID) -> Response:
        learning_object = get_object_or_404(
            manageable_learning_objects(user=_user(request)), id=learning_object_id
        )
        return Response(ManagementLearningObjectSerializer(learning_object).data)

    def patch(self, request: Request, learning_object_id: UUID) -> Response:
        serializer = LearningObjectUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        expected_revision = int(data.pop("expected_revision"))
        try:
            learning_object = revise_learning_object(
                actor=_user(request),
                learning_object_id=learning_object_id,
                expected_revision=expected_revision,
                data=_write_input(actor=_user(request), data=data),
            )
        except ContentConflictError as error:
            raise ContentConflict() from error
        except ContentRuleError as error:
            raise _rule_error(error) from error
        return Response(ManagementLearningObjectSerializer(learning_object).data)


class _RevisionActionView(APIView):
    permission_classes = [IsCreatorOrAdministrator]
    service_action = staticmethod(submit_for_review)

    def post(self, request: Request, learning_object_id: UUID) -> Response:
        serializer = RevisionActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            learning_object = self.service_action(
                actor=_user(request),
                learning_object_id=learning_object_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except ContentConflictError as error:
            raise ContentConflict() from error
        except ContentRuleError as error:
            raise _rule_error(error) from error
        return Response(ManagementLearningObjectSerializer(learning_object).data)


class SubmitLearningObjectView(_RevisionActionView):
    service_action = staticmethod(submit_for_review)


class PublishLearningObjectView(_RevisionActionView):
    service_action = staticmethod(publish_learning_object)


class ArchiveLearningObjectView(_RevisionActionView):
    service_action = staticmethod(archive_learning_object)


class RejectLearningObjectView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def post(self, request: Request, learning_object_id: UUID) -> Response:
        serializer = RejectActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            learning_object = reject_learning_object(
                actor=_user(request),
                learning_object_id=learning_object_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
                review_note=str(serializer.validated_data["review_note"]),
            )
        except ContentConflictError as error:
            raise ContentConflict() from error
        except ContentRuleError as error:
            raise _rule_error(error) from error
        return Response(ManagementLearningObjectSerializer(learning_object).data)


class TransferLearningObjectView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def post(self, request: Request, learning_object_id: UUID) -> Response:
        serializer = TransferActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            learning_object = transfer_learning_object(
                actor=_user(request),
                learning_object_id=learning_object_id,
                new_owner=get_object_or_404(User, id=serializer.validated_data["owner_id"]),
                expected_revision=int(serializer.validated_data["expected_revision"]),
            )
        except ContentConflictError as error:
            raise ContentConflict() from error
        except ContentRuleError as error:
            raise _rule_error(error) from error
        return Response(ManagementLearningObjectSerializer(learning_object).data)

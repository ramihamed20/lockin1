from uuid import UUID

from django.conf import settings
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.accounts.models import User

from . import services
from .models import ExplainAttempt, ExplainQuestion
from .serializers import ArtifactWriteSerializer, AttemptWriteSerializer


def actor(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


class StudyWriteThrottle(UserRateThrottle):
    rate = "120/min"
    scope = "knowledge_write"


class BootstrapView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, document_id: UUID) -> Response:
        document = services.document_for(actor(request), document_id)
        if not settings.KNOWLEDGE_ENABLED:
            return Response({"enabled": False})
        flags = services.tool_flags(document)
        questions = (
            ExplainQuestion.objects.filter(
                published=True,
                source__in=services.sources_for(document),
            )
            .select_related("source")
            .prefetch_related("concepts")[:100]
            if flags["explain"]
            else []
        )
        artifacts = (
            services.own_artifacts(actor(request), document)
            .select_related("source_version", "document")
            .defer("content", "source_version__metadata", "source_version__summary")[:100]
        )
        attempts = (
            ExplainAttempt.objects.filter(
                owner=actor(request),
                source__in=services.sources_for(document),
            ).order_by("-created_at")[:100]
            if flags["explain"]
            else []
        )
        return Response(
            {
                "enabled": True,
                "tools": flags,
                "source": {
                    "document_id": str(document.id),
                    "source_version_id": str(document.version_id),
                    "source_file_id": str(document.managed_file_id),
                    "edition": document.edition,
                    "source_edition": document.edition,
                    "source_title": document.version.title,
                    "source_version_number": document.version.version_number,
                },
                "artifacts": [
                    services.artifact_payload(item, document, include_content=False)
                    for item in artifacts
                ],
                "questions": [services.question_payload(item) for item in questions],
                "attempts": [services.attempt_payload(item) for item in attempts],
                "concepts": services.knowledge_projection(actor(request), document),
            }
        )


class ArtifactView(APIView):
    throttle_classes = [StudyWriteThrottle]

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, document_id: UUID, artifact_id: UUID) -> Response:
        from rest_framework.exceptions import NotFound

        from .models import StudentArtifact

        services.require_enabled()
        document = services.document_for(actor(request), document_id)
        item = StudentArtifact.objects.filter(
            pk=artifact_id,
            owner=actor(request),
            source_version__learning_object_id=document.version.learning_object_id,
        ).first()
        if not item:
            raise NotFound()
        return Response(services.artifact_payload(item, document))

    @extend_schema(request=ArtifactWriteSerializer, responses={200: OpenApiTypes.OBJECT})
    def put(self, request: Request, document_id: UUID, artifact_id: UUID) -> Response:
        document = services.document_for(actor(request), document_id)
        serializer = ArtifactWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            services.save_artifact(
                actor(request),
                document,
                artifact_id,
                serializer.validated_data,
            )
        )


class AttemptView(APIView):
    throttle_classes = [StudyWriteThrottle]

    @extend_schema(request=AttemptWriteSerializer, responses={200: OpenApiTypes.OBJECT})
    def put(self, request: Request, document_id: UUID, attempt_id: UUID) -> Response:
        document = services.document_for(actor(request), document_id)
        serializer = AttemptWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            services.save_attempt(
                actor(request),
                document,
                attempt_id,
                serializer.validated_data,
            )
        )


class McqExplainLinksView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, document_id: UUID, attempt_id: UUID) -> Response:
        from .focus_links import explain_links

        document = services.document_for(actor(request), document_id)
        return Response(explain_links(actor(request), document, attempt_id))


class McqRunExplainLinksView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, document_id: UUID, run_id: UUID) -> Response:
        from .focus_links import resumed_explain_links

        services.require_enabled()
        document = services.document_for(actor(request), document_id)
        return Response(resumed_explain_links(actor(request), document, run_id))


class LibraryView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request) -> Response:
        from rest_framework.exceptions import APIException

        from apps.content.models import CatalogDocument

        from .models import StudentArtifact

        if not settings.KNOWLEDGE_ENABLED:
            return Response({"enabled": False, "documents": []})
        artifact_ids = StudentArtifact.objects.filter(
            owner=actor(request),
            deleted=False,
        ).values_list("source_version__learning_object_id", flat=True)
        attempt_ids = ExplainAttempt.objects.filter(owner=actor(request)).values_list(
            "source__concept__sheet_id",
            flat=True,
        )
        documents = (
            CatalogDocument.objects.filter(
                version__learning_object_id__in=artifact_ids.union(attempt_ids),
                is_active=True,
            )
            .select_related("version")
            .order_by("-updated_at")[:20]
        )
        results = []
        for document in documents:
            try:
                services.document_for(actor(request), document.id)
            except APIException:
                continue
            results.append(
                {
                    "id": str(document.id),
                    "title": document.version.title,
                    "reader_url": (
                        f"/materials/catalog/{document.material_slug}/sheets/"
                        f"{document.sheet_slug}/workspace"
                    ),
                }
            )
        return Response({"enabled": True, "documents": results})


class ReviewRecoveryView(APIView):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, item_id: UUID) -> Response:
        from .focus_links import review_recovery_links

        return Response(review_recovery_links(actor(request), item_id))

from typing import Any
from uuid import UUID

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from platform_core.api.serializers import StrictSerializer

from .admin_views import _ContentPermissionView, _edition, _raise_rule
from .models import LearningObject, SheetPageTranslation
from .services import ContentConflictError, ContentFieldError, ContentRuleError
from .sheet_translation import (
    MAX_IMPORT_PAGES,
    MAX_TRANSLATION_LENGTH,
    admin_translations,
    save_admin_translations,
)
from .sheet_translation_batch import (
    _subject_node_for_sheet,
    apply_translations,
    export_translation_manifest,
    find_sheets_for_translation,
    preview_translations,
)
from .views import _catalog_document_by_id, _user


class TranslationQuerySerializer(serializers.Serializer[dict[str, Any]]):
    page = serializers.IntegerField(min_value=1)


class TranslationResponseSerializer(serializers.Serializer[dict[str, Any]]):
    page = serializers.IntegerField()
    target_language = serializers.CharField()
    machine_translated = serializers.BooleanField()
    status = serializers.ChoiceField(choices=["ready", "unavailable"])
    source_text = serializers.CharField(allow_blank=True)
    translated_text = serializers.CharField(allow_blank=True)


class TranslationTextField(serializers.CharField):
    def to_internal_value(self, data: Any) -> str:
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


class TranslationPageInput(StrictSerializer):
    page = serializers.IntegerField(min_value=1)
    text = TranslationTextField(max_length=MAX_TRANSLATION_LENGTH, allow_blank=True)
    source_text = TranslationTextField(
        max_length=MAX_TRANSLATION_LENGTH, allow_blank=True, required=False
    )
    expected_revision = serializers.IntegerField(min_value=0)


class TranslationUploadInput(StrictSerializer):
    file_id = serializers.UUIDField()
    checksum = serializers.RegexField(r"^[0-9a-f]{64}$")
    pages = serializers.ListField(
        child=TranslationPageInput(), min_length=1, max_length=MAX_IMPORT_PAGES
    )


class TranslationBatchImportInput(StrictSerializer):
    payload = serializers.JSONField()
    preview_token = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=2000
    )


class AdminSheetTranslationImportView(_ContentPermissionView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request: Request, sheet_id: UUID) -> Response:
        edition = _edition(request)
        scope = (request.query_params.get("scope") or "sheet").strip().lower()
        if scope not in {"sheet", "subject"}:
            raise serializers.ValidationError({"scope": "Scope must be sheet or subject."})
        try:
            anchor = LearningObject.objects.select_related(
                "current_version__academic_node",
                "published_version__academic_node",
            ).get(id=sheet_id)
            if scope == "subject":
                subject_node = _subject_node_for_sheet(anchor)
                sheets = (
                    find_sheets_for_translation(subject_id=subject_node.id)
                    if subject_node is not None
                    else [anchor]
                )
            else:
                sheets = [anchor]
            payload = export_translation_manifest(
                sheets=sheets,
                edition=edition,
                extract_pdf_source=True,
                single_sheet_format=(scope == "sheet"),
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        response = Response(payload)
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(request=TranslationBatchImportInput, responses=OpenApiTypes.OBJECT)
    def post(self, request: Request, sheet_id: UUID) -> Response:
        serializer = TranslationBatchImportInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        raw_payload = serializer.validated_data["payload"]
        if not isinstance(raw_payload, dict):
            raise serializers.ValidationError({"payload": "Translation payload must be an object."})
        token = str(serializer.validated_data.get("preview_token") or "").strip()
        try:
            if token:
                result = apply_translations(
                    raw=raw_payload,
                    preview_token=token,
                    actor=_user(request),
                    default_sheet_id=sheet_id,
                    default_edition=_edition(request),
                    allow_production=True,
                )
            else:
                result = preview_translations(
                    raw=raw_payload,
                    actor=_user(request),
                    default_sheet_id=sheet_id,
                    default_edition=_edition(request),
                )
        except (
            LearningObject.DoesNotExist,
            ContentConflictError,
            ContentFieldError,
            ContentRuleError,
        ) as error:
            _raise_rule(error)
        return Response(result)


class AdminSheetTranslationView(_ContentPermissionView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request: Request, sheet_id: UUID) -> Response:
        try:
            payload = admin_translations(
                actor=_user(request), sheet_id=sheet_id, edition=_edition(request)
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        response = Response(payload)
        response["Cache-Control"] = "private, no-store"
        return response

    @extend_schema(request=TranslationUploadInput, responses=OpenApiTypes.OBJECT)
    def put(self, request: Request, sheet_id: UUID) -> Response:
        serializer = TranslationUploadInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            payload = save_admin_translations(
                actor=_user(request),
                sheet_id=sheet_id,
                edition=_edition(request),
                **serializer.validated_data,
            )
        except (LearningObject.DoesNotExist, ContentRuleError) as error:
            _raise_rule(error)
        return Response(payload)


class DocumentTranslationView(APIView):
    @extend_schema(parameters=[TranslationQuerySerializer], responses=TranslationResponseSerializer)
    def get(self, request: Request, document_id: UUID) -> Response:
        document = _catalog_document_by_id(user=_user(request), document_id=document_id)
        serializer = TranslationQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        page = serializer.validated_data["page"]
        file = document.managed_file
        if file.pdf_page_count and page > file.pdf_page_count:
            raise serializers.ValidationError({"page": "Page is outside this sheet."})
        row = (
            SheetPageTranslation.objects.filter(
                managed_file=file, checksum=file.checksum_sha256, page=page
            )
            .exclude(translated_text="")
            .first()
        )
        response = Response(
            {
                "page": page,
                "target_language": "ar",
                "machine_translated": False,
                "status": "ready" if row else "unavailable",
                "source_text": row.source_text if row else "",
                "translated_text": row.translated_text if row else "",
            }
        )
        response["Cache-Control"] = "private, no-store"
        return response

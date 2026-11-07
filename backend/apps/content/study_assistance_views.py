from typing import Any
from uuid import UUID

from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.exceptions import APIException, NotFound, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from platform_core.api.serializers import StrictSerializer

from .admin_views import _ContentPermissionView
from .editions import EDITIONS, VIEWS
from .models import LearningObject, SavedStudyAssistanceIdea, StudyAssistanceIdea
from .study_assistance import (
    AssistanceConflict,
    AssistanceRuleError,
    admin_payload,
    idea_payload,
    published_ideas,
    scope_page_count,
    student_ideas,
    write_idea,
)
from .views import _catalog_document_by_id, _user


class AssistanceQuerySerializer(StrictSerializer):
    view = serializers.ChoiceField(choices=VIEWS, default="study")
    page = serializers.IntegerField(min_value=1, max_value=10000, required=False)
    saved = serializers.BooleanField(default=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if not attrs["saved"] and "page" not in attrs:
            raise ValidationError({"page": "Choose the page you are reading."})
        return attrs


class AssistanceSaveSerializer(StrictSerializer):
    view = serializers.ChoiceField(choices=VIEWS, default="study")
    saved = serializers.BooleanField()


class AdminAssistanceQuerySerializer(StrictSerializer):
    edition = serializers.ChoiceField(choices=EDITIONS, default="university")
    view = serializers.ChoiceField(choices=VIEWS, default="study")


class AdminAssistanceSerializer(StrictSerializer):
    source_version_id = serializers.UUIDField()
    edition = serializers.ChoiceField(choices=EDITIONS, default="university")
    view = serializers.ChoiceField(choices=VIEWS, default="study")
    page = serializers.IntegerField(min_value=1, max_value=10000, allow_null=True, default=None)
    kind = serializers.ChoiceField(choices=StudyAssistanceIdea.Kind.choices, default="understand")
    teaser = serializers.CharField(max_length=240)
    question = serializers.CharField(max_length=1000)
    explanation = serializers.CharField(max_length=5000)
    followup_question = serializers.CharField(
        max_length=1000, required=False, default="", allow_blank=True
    )
    followup_answer = serializers.CharField(
        max_length=3000, required=False, default="", allow_blank=True
    )
    position = serializers.IntegerField(min_value=0, max_value=1000000, default=0)
    is_published = serializers.BooleanField(default=False)
    expected_revision = serializers.IntegerField(min_value=1, required=False)


class AssistanceConflictError(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "study_assistance_conflict"
    default_detail = "This idea changed. Reload it before saving."


def _sheet(sheet_id: UUID) -> LearningObject:
    return get_object_or_404(
        LearningObject.objects.select_related("current_version"),
        id=sheet_id,
        current_version__content_type="pdf",
    )


class DocumentStudyAssistanceView(APIView):
    def get(self, request: Request, document_id: UUID) -> Response:
        user = _user(request)
        document = _catalog_document_by_id(user=user, document_id=document_id)
        serializer = AssistanceQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            results = student_ideas(
                user=user,
                document=document,
                view=data["view"],
                page=data.get("page"),
                saved_only=data["saved"],
            )
        except AssistanceRuleError as error:
            raise ValidationError(str(error)) from error
        response = Response({"results": results, "version_id": str(document.version_id)})
        response["Cache-Control"] = "private, no-store"
        return response


class StudyAssistanceSavedView(APIView):
    def put(self, request: Request, document_id: UUID, idea_id: UUID) -> Response:
        user = _user(request)
        document = _catalog_document_by_id(user=user, document_id=document_id)
        serializer = AssistanceSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            idea = published_ideas(document=document, view=data["view"]).filter(id=idea_id).first()
        except AssistanceRuleError as error:
            raise ValidationError(str(error)) from error
        if idea is None:
            raise NotFound("Idea not found.")
        if data["saved"]:
            SavedStudyAssistanceIdea.objects.get_or_create(user=user, idea=idea)
        else:
            SavedStudyAssistanceIdea.objects.filter(user=user, idea=idea).delete()
        return Response({"idea": idea_payload(idea, saved=data["saved"])})


class AdminStudyAssistanceView(_ContentPermissionView):
    def get(self, request: Request, sheet_id: UUID) -> Response:
        sheet = _sheet(sheet_id)
        serializer = AdminAssistanceQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        version = sheet.current_version
        if version is None:
            raise NotFound("Sheet version not found.")
        available = True
        try:
            count = scope_page_count(version=version, edition=data["edition"], view=data["view"])
        except AssistanceRuleError:
            count, available = None, False
        rows = StudyAssistanceIdea.objects.filter(source_version=version, **data)
        return Response(
            {
                "results": [admin_payload(idea) for idea in rows[:200]],
                "version_id": str(version.id),
                "page_count": count,
                "available": available,
            }
        )

    def post(self, request: Request, sheet_id: UUID) -> Response:
        return self._write(request, sheet_id)

    def _write(self, request: Request, sheet_id: UUID, idea_id: UUID | None = None) -> Response:
        sheet = _sheet(sheet_id)
        version = sheet.current_version
        if version is None:
            raise NotFound("Sheet version not found.")
        serializer = AdminAssistanceSerializer(data=request.data, partial=idea_id is not None)
        serializer.is_valid(raise_exception=True)
        changes = dict(serializer.validated_data)
        if changes.pop("source_version_id", None) != version.id:
            raise AssistanceConflictError("The sheet changed. Reload its current version first.")
        try:
            idea = write_idea(
                actor=_user(request),
                version=version,
                changes=changes,
                idea_id=idea_id,
            )
        except StudyAssistanceIdea.DoesNotExist as error:
            raise NotFound("Idea not found.") from error
        except AssistanceConflict as error:
            raise AssistanceConflictError() from error
        except AssistanceRuleError as error:
            raise ValidationError(str(error)) from error
        return Response(
            {"idea": admin_payload(idea)},
            status=status.HTTP_201_CREATED if idea_id is None else status.HTTP_200_OK,
        )


class AdminStudyAssistanceDetailView(AdminStudyAssistanceView):
    http_method_names = ["patch", "options"]

    def patch(self, request: Request, sheet_id: UUID, idea_id: UUID) -> Response:
        return self._write(request, sheet_id, idea_id)

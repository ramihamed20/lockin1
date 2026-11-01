import json
from uuid import UUID

from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from platform_core.api.serializers import StrictSerializer

from .admin_views import _ContentPermissionView
from .assistance_import import import_cards, manifest
from .study_assistance_views import AdminAssistanceQuerySerializer, _sheet
from .views import _user


class ImportRequestSerializer(StrictSerializer):
    payload = serializers.JSONField()
    publish = serializers.BooleanField(default=False)
    preview_token = serializers.CharField(required=False, default="", max_length=2000)


class AdminAssistanceImportView(_ContentPermissionView):
    def get(self, request: Request, sheet_id: UUID) -> Response:
        query = AdminAssistanceQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        return Response(manifest(_sheet(sheet_id), **query.validated_data))

    def post(self, request: Request, sheet_id: UUID) -> Response:
        serializer = ImportRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if len(json.dumps(data["payload"], ensure_ascii=False).encode()) > 2_000_000:
            raise ValidationError("Choose a JSON file smaller than 2 MB.")
        return Response(
            import_cards(
                actor=_user(request),
                anchor_id=sheet_id,
                raw=data["payload"],
                publish=data["publish"],
                token=data["preview_token"],
            )
        )

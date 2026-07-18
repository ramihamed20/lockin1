from typing import Any, cast

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability
from platform_core.api.exceptions import RequestRejected

from .selectors import configuration_catalog
from .serializers import ConfigurationEntrySerializer, ConfigurationUpdateSerializer
from .services import ConfigurationError, update_configuration


def _user(request: Request) -> User:
    return cast(User, request.user)


class ConfigurationListView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.CONFIGURATION_VIEW

    @extend_schema(responses=ConfigurationEntrySerializer(many=True))
    def get(self, request: Request) -> Response:
        serializer = ConfigurationEntrySerializer(cast(Any, configuration_catalog()), many=True)
        return Response({"results": serializer.data})


class ConfigurationDetailView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.CONFIGURATION_MANAGE

    @extend_schema(request=ConfigurationUpdateSerializer, responses=ConfigurationEntrySerializer)
    def patch(self, request: Request, key: str) -> Response:
        serializer = ConfigurationUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        try:
            update_configuration(
                key=key,
                value=data["value"],
                expected_version=data["expected_version"],
                actor=_user(request),
                reason=data["reason"],
                source="operations.api",
            )
        except ConfigurationError as error:
            raise RequestRejected(str(error), code="configuration_update_rejected") from error
        entry = next(item for item in configuration_catalog() if item["key"] == key)
        return Response(ConfigurationEntrySerializer(entry).data)

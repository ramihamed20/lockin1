from typing import Any, cast

from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability
from platform_core.api.exceptions import RequestRejected

from .serializers import (
    ActionExecuteSerializer,
    ActionPreviewRequestSerializer,
    OperationalActionRunSerializer,
)
from .services import OperationalActionError, execute_action, preview_action


def _user(request: Request) -> User:
    return cast(User, request.user)


class ActionPreviewView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.ACTIONS_EXECUTE

    @extend_schema(request=ActionPreviewRequestSerializer, responses=OperationalActionRunSerializer)
    def post(self, request: Request) -> Response:
        serializer = ActionPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        try:
            run, token = preview_action(actor=_user(request), **data)
        except OperationalActionError as error:
            raise RequestRejected(str(error), code="operational_action_preview_rejected") from error
        payload = OperationalActionRunSerializer(run).data
        payload["confirmation_token"] = token
        return Response(payload, status=201)


class ActionExecuteView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.ACTIONS_EXECUTE

    @extend_schema(request=ActionExecuteSerializer, responses=OperationalActionRunSerializer)
    def post(self, request: Request, run_id: str) -> Response:
        serializer = ActionExecuteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = cast(dict[str, Any], serializer.validated_data)["confirmation_token"]
        try:
            run = execute_action(
                run_id=run_id,
                confirmation_token=token,
                actor=_user(request),
                source="operations.api",
            )
        except OperationalActionError as error:
            raise RequestRejected(
                str(error), code="operational_action_execution_rejected"
            ) from error
        return Response(OperationalActionRunSerializer(run).data)

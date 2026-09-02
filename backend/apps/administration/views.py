from typing import Any, cast
from uuid import UUID

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.system_configuration.services import get_configuration_value
from platform_core.api.exceptions import RequestRejected
from platform_core.api.pagination import LockinPagination

from .catalog import Capability
from .permissions import HasOperationalCapability
from .selectors import (
    content_dashboard,
    operational_resource_catalog,
    operational_users,
    operations_session,
    overview_dashboard,
    serialize_operational_user,
    support_dashboard,
    system_health_dashboard,
)
from .serializers import OperationalRoleUpdateSerializer, OperationalUserSerializer
from .services import OperationalRoleError, replace_operational_roles


def _user(request: Request) -> User:
    return cast(User, request.user)


class OperationsSessionView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.OVERVIEW_VIEW

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request: Request) -> Response:
        return Response(operations_session(user=_user(request)))


class OperationalResourceListView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.OVERVIEW_VIEW

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request: Request) -> Response:
        return Response({"results": operational_resource_catalog(user=_user(request))})


class OverviewDashboardView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.OVERVIEW_VIEW

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request: Request) -> Response:
        return Response(
            overview_dashboard(
                user=_user(request),
                days=int(get_configuration_value("analytics.default_window_days")),
            )
        )


class ContentDashboardView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.CONTENT_VIEW

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request: Request) -> Response:
        return Response(content_dashboard())


class SupportDashboardView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.USERS_VIEW

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request: Request) -> Response:
        return Response(
            support_dashboard(days=int(get_configuration_value("analytics.default_window_days")))
        )


class SystemHealthView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.SYSTEM_HEALTH_VIEW

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request: Request) -> Response:
        return Response(system_health_dashboard())


class OperationalUserListView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.USERS_VIEW

    @extend_schema(responses=OperationalUserSerializer(many=True))
    def get(self, request: Request) -> Response:
        users = operational_users(
            query=request.query_params.get("q", "")[:100],
            status=request.query_params.get("status", "")[:20],
            role=request.query_params.get("role", "")[:40],
            ordering=request.query_params.get("ordering", "-date_joined")[:40],
        )
        paginator = LockinPagination()
        page = paginator.paginate_queryset(users, request, view=self)
        payload = [serialize_operational_user(user) for user in (page or [])]
        serialized = OperationalUserSerializer(cast(Any, payload), many=True)
        return paginator.get_paginated_response(serialized.data)


class OperationalUserRolesView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.ROLES_MANAGE

    @extend_schema(request=OperationalRoleUpdateSerializer, responses=OpenApiTypes.OBJECT)
    def patch(self, request: Request, user_id: UUID) -> Response:
        serializer = OperationalRoleUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        try:
            target = User.objects.get(id=user_id)
            roles = replace_operational_roles(
                target=target,
                actor=_user(request),
                role_codes=data["roles"],
                reason=data["reason"],
                source="operations.api",
            )
        except User.DoesNotExist as error:
            raise RequestRejected("User was not found.", code="user_not_found") from error
        except OperationalRoleError as error:
            raise RequestRejected(str(error), code="operational_role_change_rejected") from error
        return Response({"roles": roles})

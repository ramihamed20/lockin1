from typing import cast
from uuid import UUID

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import CreatorScope, EducationNode
from .permissions import IsCreatorOrAdministrator
from .policies import is_administrator
from .selectors import manageable_nodes, node_breadcrumbs, public_node, public_nodes
from .serializers import (
    CreatorScopeSerializer,
    CreatorScopeWriteSerializer,
    EducationNodeCreateSerializer,
    EducationNodeMoveSerializer,
    EducationNodeSerializer,
    EducationNodeStatusSerializer,
    EducationNodeUpdateSerializer,
)
from .services import (
    EducationConflictError,
    EducationRuleError,
    ScopeCapabilities,
    create_node,
    grant_creator_scope,
    move_node,
    revoke_creator_scope,
    set_node_status,
    update_node,
)


class EducationConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This hierarchy node changed. Reload it and try again."
    default_code = "revision_conflict"


class EducationRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "education_rule_rejected"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _rule_error(error: EducationRuleError) -> APIException:
    message = str(error)
    lowered = message.lower()
    if lowered.startswith("you cannot") or lowered.startswith("only administrators"):
        return PermissionDenied(message)
    return EducationRejected(message)


class PublicEducationNodeListView(ListAPIView[EducationNode]):
    serializer_class = EducationNodeSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        raw_parent = self.request.query_params.get("parent")
        if not raw_parent:
            return public_nodes(parent_id=None)
        try:
            parent_id = UUID(raw_parent)
        except ValueError as error:
            raise NotFound("Education node not found.") from error
        return public_nodes(parent_id=parent_id)


class PublicEducationNodeDetailView(APIView):
    def get(self, request: Request, node_id: UUID) -> Response:
        try:
            node = public_node(node_id=node_id)
        except EducationNode.DoesNotExist as error:
            raise NotFound("Education node not found.") from error
        return Response(
            {
                "node": EducationNodeSerializer(node).data,
                "breadcrumbs": EducationNodeSerializer(node_breadcrumbs(node), many=True).data,
            }
        )


class ManagementEducationNodeListView(ListAPIView[EducationNode]):
    permission_classes = [IsCreatorOrAdministrator]
    serializer_class = EducationNodeSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        return manageable_nodes(user=_user(self.request))

    def post(self, request: Request) -> Response:
        serializer = EducationNodeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        parent_id = data.get("parent_id")
        parent = get_object_or_404(EducationNode, id=parent_id) if parent_id is not None else None
        try:
            node = create_node(
                actor=_user(request),
                parent=parent,
                kind=str(data["kind"]),
                title=str(data["title"]),
                slug=str(data["slug"]) if data.get("slug") else None,
                description=str(data.get("description", "")),
                position=int(data["position"]),
            )
        except EducationRuleError as error:
            raise _rule_error(error) from error
        return Response(EducationNodeSerializer(node).data, status=status.HTTP_201_CREATED)


class ManagementEducationNodeDetailView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def patch(self, request: Request, node_id: UUID) -> Response:
        serializer = EducationNodeUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            node = update_node(
                actor=_user(request),
                node_id=node_id,
                expected_revision=int(data.pop("expected_revision")),
                **data,
            )
        except EducationConflictError as error:
            raise EducationConflict() from error
        except EducationRuleError as error:
            raise _rule_error(error) from error
        return Response(EducationNodeSerializer(node).data)


class ManagementEducationNodeMoveView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def post(self, request: Request, node_id: UUID) -> Response:
        serializer = EducationNodeMoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            node = move_node(
                actor=_user(request),
                node_id=node_id,
                new_parent_id=cast(UUID | None, data["parent_id"]),
                expected_revision=int(data["expected_revision"]),
                position=int(data["position"]),
            )
        except EducationConflictError as error:
            raise EducationConflict() from error
        except (EducationRuleError, EducationNode.DoesNotExist) as error:
            raise _rule_error(EducationRuleError(str(error))) from error
        return Response(EducationNodeSerializer(node).data)


class ManagementEducationNodeStatusView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def post(self, request: Request, node_id: UUID) -> Response:
        serializer = EducationNodeStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            node = set_node_status(
                actor=_user(request),
                node_id=node_id,
                expected_revision=int(data["expected_revision"]),
                status=str(data["status"]),
            )
        except EducationConflictError as error:
            raise EducationConflict() from error
        except EducationRuleError as error:
            raise _rule_error(error) from error
        return Response(EducationNodeSerializer(node).data)


class CreatorScopeListView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def get(self, request: Request) -> Response:
        user = _user(request)
        scopes = CreatorScope.objects.select_related("user", "node").order_by(
            "node__path", "user__email"
        )
        if not is_administrator(user):
            scopes = scopes.filter(user=user)
        return Response({"scopes": CreatorScopeSerializer(scopes, many=True).data})

    def post(self, request: Request) -> Response:
        actor = _user(request)
        if not is_administrator(actor):
            raise PermissionDenied("Only administrators can grant creator scopes.")
        serializer = CreatorScopeWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            scope = grant_creator_scope(
                actor=actor,
                user=get_object_or_404(User, id=data["user_id"]),
                node=get_object_or_404(EducationNode, id=data["node_id"]),
                capabilities=ScopeCapabilities(
                    can_create_content=bool(data["can_create_content"]),
                    can_review_content=bool(data["can_review_content"]),
                    can_publish_content=bool(data["can_publish_content"]),
                    can_manage_hierarchy=bool(data["can_manage_hierarchy"]),
                ),
            )
        except EducationRuleError as error:
            raise _rule_error(error) from error
        return Response(CreatorScopeSerializer(scope).data, status=status.HTTP_201_CREATED)


class CreatorScopeDetailView(APIView):
    permission_classes = [IsCreatorOrAdministrator]

    def delete(self, request: Request, scope_id: UUID) -> Response:
        try:
            revoke_creator_scope(actor=_user(request), scope_id=scope_id)
        except EducationRuleError as error:
            raise _rule_error(error) from error
        return Response(status=status.HTTP_204_NO_CONTENT)

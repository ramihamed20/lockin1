import re
from typing import cast
from uuid import UUID

from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from platform_core.api.serializers import StrictSerializer

from .friends import friends_payload, links, person, request_friend, respond_friend
from .models import User


def active_user(request: Request) -> User:
    user = cast(User, request.user)
    if not user.is_active or user.status != "active":
        raise PermissionDenied()
    return user


class FriendTargetSerializer(StrictSerializer):
    user_id = serializers.UUIDField()


class FriendsView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request) -> Response:
        return Response(friends_payload(active_user(request)))


class FriendSearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        user = active_user(request)
        username = request.query_params.get("username", "").strip().lstrip("@").lower()
        if not re.fullmatch(r"[a-z0-9_]{3,30}", username):
            return Response({"users": []})
        peer = (
            User.objects.filter(username__iexact=username, is_active=True, status="active")
            .exclude(pk=user.pk)
            .first()
        )
        if peer is None:
            return Response({"users": []})
        link = links(user).filter(Q(first=peer) | Q(second=peer)).exclude(status="declined").first()
        relation = (
            "none"
            if link is None
            else "friends"
            if link.status == "accepted"
            else "outgoing"
            if link.requested_by_id == user.pk
            else "incoming"
        )
        return Response(
            {
                "users": [
                    {
                        **person(peer),
                        "relation": relation,
                        "request_id": str(link.pk) if link else None,
                    }
                ]
            }
        )


class FriendRequestView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=FriendTargetSerializer, responses={201: OpenApiTypes.OBJECT})
    def post(self, request: Request) -> Response:
        user = active_user(request)
        if user.status != "active":
            raise PermissionDenied()
        serializer = FriendTargetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_friend(user=user, peer_id=serializer.validated_data["user_id"])
        return Response(friends_payload(user), status=201)


class FriendResponseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request, request_id: UUID, action: str) -> Response:
        if action not in {"accept", "decline", "cancel", "remove"}:
            raise PermissionDenied()
        user = active_user(request)
        respond_friend(user=user, request_id=request_id, action=action)
        return Response(friends_payload(user))

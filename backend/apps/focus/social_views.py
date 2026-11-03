from uuid import UUID

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from platform_core.api.serializers import StrictSerializer

from .services import FocusTeamLimitError
from .team_invitations import invitation_payload, invite_friend, respond_invitation
from .views import _authorize, _rule_error, _team_payload


class InviteFriendSerializer(StrictSerializer):
    user_id = serializers.UUIDField()


class TeamInvitationsView(APIView):
    def get(self, request: Request) -> Response:
        return Response(invitation_payload(_authorize(request)))


class InviteFriendView(APIView):
    @extend_schema(request=InviteFriendSerializer, responses={201: OpenApiTypes.OBJECT})
    def post(self, request: Request, team_id: UUID) -> Response:
        user = _authorize(request)
        serializer = InviteFriendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invite_friend(user=user, team_id=team_id, peer_id=serializer.validated_data["user_id"])
        return Response(invitation_payload(user), status=201)


class TeamInvitationResponseView(APIView):
    def post(self, request: Request, invitation_id: UUID, action: str) -> Response:
        if action not in {"accept", "decline"}:
            raise PermissionDenied()
        user = _authorize(request)
        try:
            team = respond_invitation(user=user, invitation_id=invitation_id, action=action)
        except FocusTeamLimitError as error:
            raise _rule_error(error) from error
        return Response(
            {
                "team": _team_payload(user=user, team=team) if team else None,
                **invitation_payload(user),
            }
        )

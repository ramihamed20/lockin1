from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role

from .models import RankingDefinition
from .selectors import current_ranking
from .serializers import RankingProfileSerializer
from .services import build_snapshot, get_or_create_profile


class CurrentRankingView(APIView):
    def get(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        return Response(
            current_ranking(
                viewer=request.user, code=request.query_params.get("code", "learning_all_time")
            )
        )


class RankingProfileView(APIView):
    def get(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        return Response(RankingProfileSerializer(get_or_create_profile(user=request.user)).data)

    def put(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        profile = get_or_create_profile(user=request.user)
        serializer = RankingProfileSerializer(profile, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class RankingBuildView(APIView):
    def post(self, request: Request, code: str) -> Response:
        assert isinstance(request.user, User)
        if not user_has_role(request.user, Role.ADMINISTRATOR):
            raise PermissionDenied()
        definition = RankingDefinition.objects.get(code=code, is_active=True)
        snapshot = build_snapshot(definition=definition)
        return Response(
            {"id": snapshot.id, "status": snapshot.status, "generated_at": snapshot.generated_at}
        )

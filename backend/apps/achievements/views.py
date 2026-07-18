from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .selectors import achievement_catalog_for_user


class AchievementCatalogView(APIView):
    def get(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        return Response(
            achievement_catalog_for_user(
                user=request.user, language=request.user.preferred_language
            )
        )

from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .selectors import streak_summary_for_user


class StreakSummaryView(APIView):
    def get(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        return Response(streak_summary_for_user(user=request.user))

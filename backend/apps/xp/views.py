from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import XpTransaction
from .selectors import xp_ledger_for_user, xp_summary_for_user
from .serializers import XpTransactionSerializer


class XpSummaryView(APIView):
    def get(self, request: Request) -> Response:
        assert isinstance(request.user, User)
        return Response(xp_summary_for_user(user=request.user))


class XpLedgerView(ListAPIView[XpTransaction]):
    serializer_class = XpTransactionSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        assert isinstance(self.request.user, User)
        return xp_ledger_for_user(user=self.request.user)

from datetime import datetime, time, timedelta
from typing import cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone
from rest_framework import serializers
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
        return Response(xp_summary_for_user(user=cast(User, request.user)))


class XpLedgerView(ListAPIView[XpTransaction]):
    serializer_class = XpTransactionSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        filters = XpLedgerFilterSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        period = filters.validated_data["period"]
        zone = ZoneInfo(filters.validated_data["timezone"])
        queryset = xp_ledger_for_user(user=cast(User, self.request.user))
        if period == "all":
            return queryset
        today = timezone.now().astimezone(zone).date()
        start = today - timedelta(days=today.weekday() if period == "week" else 27)
        return queryset.filter(
            occurred_at__gte=datetime.combine(start, time.min, tzinfo=zone),
            occurred_at__lt=datetime.combine(today + timedelta(days=1), time.min, tzinfo=zone),
        )


class XpLedgerFilterSerializer(serializers.Serializer[dict[str, object]]):
    period = serializers.ChoiceField(choices=("week", "month", "all"), default="all")
    timezone = serializers.CharField(max_length=64, default="UTC")

    def validate_timezone(self, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise serializers.ValidationError("Choose a valid timezone.") from error
        return value

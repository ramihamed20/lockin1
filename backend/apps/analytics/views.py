from datetime import UTC, datetime, timedelta
from typing import Any, cast

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability, has_operational_capability
from apps.system_configuration.services import get_configuration_value
from platform_core.api.exceptions import RequestRejected

from .catalog import METRICS
from .selectors import analytics_series
from .serializers import AnalyticsQuerySerializer


class AnalyticsSeriesView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.ANALYTICS_VIEW

    @extend_schema(parameters=[AnalyticsQuerySerializer], responses=OpenApiTypes.OBJECT)
    def get(self, request: Request) -> Response:
        payload = {
            "date_from": request.query_params.get("from"),
            "date_to": request.query_params.get("to"),
            "metrics": request.query_params.getlist("metric"),
        }
        serializer = AnalyticsQuerySerializer(
            data={key: value for key, value in payload.items() if value}
        )
        serializer.is_valid(raise_exception=True)
        data = cast(dict[str, Any], serializer.validated_data)
        window = int(get_configuration_value("analytics.default_window_days"))
        end = data.get("date_to", datetime.now(UTC).date())
        start = data.get("date_from", end - timedelta(days=window - 1))
        if end < start or (end - start) > timedelta(days=366):
            raise RequestRejected(
                "Analytics periods must cover between 1 and 367 days.",
                code="analytics_period_invalid",
            )
        requested = frozenset(data.get("metrics") or METRICS)
        user = cast(User, request.user)
        if not has_operational_capability(user, Capability.PAYMENTS_VIEW):
            requested = frozenset(code for code in requested if not METRICS[code].finance_only)
        return Response(analytics_series(start=start, end=end, metrics=requested))

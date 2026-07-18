from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.permissions import IsAdministrator
from apps.payments.models import Payment
from apps.provider_integrations.services import create_refund_request

from .models import Refund
from .selectors import refunds_for_user
from .serializers import RefundRequestSerializer, RefundSerializer
from .services import request_refund


class MyRefundsView(ListAPIView[Refund]):
    serializer_class = RefundSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        user = self.request.user
        return refunds_for_user(user=user) if isinstance(user, User) else Refund.objects.none()


class AdminRefundRequestView(APIView):
    permission_classes = [IsAdministrator]

    def post(self, request: Request) -> Response:
        serializer = RefundRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actor = request.user
        if not isinstance(actor, User):
            raise NotFound()
        key = request.headers.get("Idempotency-Key", "")[:180]
        if len(key) < 12:
            raise ValidationError({"idempotency_key": ["A stable idempotency key is required."]})
        try:
            refund, created = request_refund(
                payment_id=serializer.validated_data["payment_id"],
                actor=actor,
                amount_minor=serializer.validated_data["amount_minor"],
                reason=serializer.validated_data["reason"],
                idempotency_key=key,
            )
            create_refund_request(refund=refund)
        except (Payment.DoesNotExist, ValueError) as error:
            raise ValidationError({"refund": [str(error)]}) from error
        return Response(
            RefundSerializer(refund).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

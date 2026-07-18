from django.db import transaction
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.product_catalog.models import Price
from apps.product_catalog.selectors import active_price
from apps.provider_integrations.services import create_checkout_session
from apps.subscriptions.services import (
    create_pending_subscription,
    get_or_create_individual_account,
)

from .models import Payment
from .selectors import payments_for_user
from .serializers import PaymentIntentSerializer, PaymentSerializer
from .services import create_payment


class MyPaymentsView(ListAPIView[Payment]):
    serializer_class = PaymentSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        user = self.request.user
        if not isinstance(user, User):
            return Payment.objects.none()
        return payments_for_user(user=user)


class PaymentIntentView(APIView):
    @transaction.atomic
    def post(self, request: Request) -> Response:
        serializer = PaymentIntentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not isinstance(user, User):
            raise NotFound()
        idempotency_key = request.headers.get("Idempotency-Key", "")[:180]
        if len(idempotency_key) < 12:
            raise ValidationError({"idempotency_key": ["A stable idempotency key is required."]})
        try:
            price = active_price(price_id=serializer.validated_data["price_id"])
            account = get_or_create_individual_account(user=user)
            subscription, _ = create_pending_subscription(
                account=account,
                plan_version=price.plan_version,
                idempotency_key=f"subscription:{idempotency_key}",
            )
            payment, created = create_payment(
                account=account,
                subscription=subscription,
                price=price,
                idempotency_key=idempotency_key,
            )
            session = create_checkout_session(payment=payment)
        except (Price.DoesNotExist, ValueError) as error:
            raise ValidationError({"payment": [str(error)]}) from error
        return Response(
            {"payment": PaymentSerializer(payment).data, "checkout": session},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

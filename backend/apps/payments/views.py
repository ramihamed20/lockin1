from django.conf import settings
from django.db import transaction
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.services import (
    auth_attempt_fingerprint,
    auth_attempt_is_limited,
    record_auth_attempt,
)
from apps.product_catalog.models import Price
from apps.product_catalog.selectors import active_libyana_price_for_plan, active_price
from apps.provider_integrations.services import create_checkout_session
from apps.subscriptions.serializers import SubscriptionSerializer
from apps.subscriptions.services import (
    create_pending_subscription,
    get_or_create_individual_account,
)
from platform_core.network import client_ip

from .manual_services import (
    DuplicateRechargeCodeError,
    ManualPaymentError,
    submit_manual_recharge,
)
from .models import Payment
from .selectors import payments_for_user
from .serializers import (
    ManualRechargeRequestSerializer,
    ManualRechargeSubmissionSerializer,
    PaymentIntentSerializer,
    PaymentSerializer,
)
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


class ManualLibyanaPaymentView(APIView):
    def post(self, request: Request) -> Response:
        serializer = ManualRechargeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not isinstance(user, User):
            raise NotFound()
        key_hash = auth_attempt_fingerprint(
            scope="manual_payment",
            identifier=str(user.id),
            remote_address=client_ip(request),
        )
        if auth_attempt_is_limited(
            key_hash=key_hash,
            scope="manual_payment",
            window_seconds=int(getattr(settings, "MANUAL_PAYMENT_RATE_WINDOW_SECONDS", 3600)),
            limit=int(getattr(settings, "MANUAL_PAYMENT_RATE_LIMIT", 5)),
        ):
            return Response(
                {
                    "detail": "Too many recharge submissions. Try again later.",
                    "code": "rate_limited",
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        record_auth_attempt(key_hash=key_hash, scope="manual_payment")
        idempotency_key = request.headers.get("Idempotency-Key", "")[:180]
        try:
            price = active_libyana_price_for_plan(plan_id=serializer.validated_data["plan_id"])
            result = submit_manual_recharge(
                user=user,
                price=price,
                recharge_code=str(serializer.validated_data["recharge_code"]),
                idempotency_key=idempotency_key,
            )
        except Price.DoesNotExist as error:
            raise ValidationError(
                {"plan_id": ["This plan is not available for Libyana payment."]}
            ) from error
        except DuplicateRechargeCodeError as error:
            raise ValidationError({"recharge_code": [str(error)]}, code="duplicate_code") from error
        except ManualPaymentError as error:
            raise ValidationError({"payment": [str(error)]}) from error
        return Response(
            {
                "payment": PaymentSerializer(result.payment).data,
                "submission": ManualRechargeSubmissionSerializer(result.submission).data,
                "subscription": SubscriptionSerializer(result.subscription).data,
            },
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )

from uuid import UUID

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListCreateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability
from apps.payments.models import Payment
from platform_core.api.serializers import StrictSerializer

from .claim_services import OPEN, create_claim, review_claim
from .models import RefundClaim


class ClaimSerializer(serializers.ModelSerializer[RefundClaim]):
    currency = serializers.CharField(source="payment.currency", read_only=True)
    currency_exponent = serializers.IntegerField(source="payment.currency_exponent", read_only=True)

    class Meta:
        model = RefundClaim
        fields = (
            "id",
            "payment_id",
            "kind",
            "remedy",
            "reason",
            "receiver_phone",
            "status",
            "received_at",
            "due_at",
            "channel",
            "policy_version",
            "quoted_amount_minor",
            "approved_amount_minor",
            "decision_reason",
            "transfer_details",
            "completed_at",
            "currency",
            "currency_exponent",
        )
        read_only_fields = fields


class ClaimRequestSerializer(StrictSerializer):
    payment_id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=RefundClaim.Kind.choices)
    remedy = serializers.ChoiceField(choices=("refund", "extension", "terminate"), default="refund")
    reason = serializers.CharField(min_length=3, max_length=1000)
    receiver_phone = serializers.RegexField(
        r"^(?:\+?218|0)?9[1-6][0-9]{7}$", required=False, allow_blank=True, default=""
    )


class ExternalClaimSerializer(ClaimRequestSerializer):
    received_at = serializers.DateTimeField()
    channel = serializers.ChoiceField(choices=("telegram", "email", "support"))


class ClaimReviewSerializer(StrictSerializer):
    transferred_to = serializers.CharField(max_length=160, default="", allow_blank=True)
    agreed_alternative = serializers.BooleanField(default=False)
    alternative_agreement_reference = serializers.CharField(
        max_length=160, default="", allow_blank=True
    )
    transferred_amount_minor = serializers.IntegerField(min_value=1, required=False)
    action = serializers.ChoiceField(
        choices=("approve", "complete", "compensate", "restore", "needs_info", "reject")
    )
    reason = serializers.CharField(min_length=8, max_length=1000)
    transfer_reference = serializers.CharField(
        max_length=160, required=False, default="", allow_blank=True
    )


class MyRefundClaimsView(ListCreateAPIView[RefundClaim]):
    permission_classes = [IsAuthenticated]
    serializer_class = ClaimSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        if not isinstance(self.request.user, User):
            return RefundClaim.objects.none()
        return (
            RefundClaim.objects.filter(user=self.request.user)
            .select_related("payment")
            .order_by("-received_at", "-id")
        )

    @extend_schema(
        request=ClaimRequestSerializer, responses={200: ClaimSerializer, 201: ClaimSerializer}
    )
    def post(self, request: Request, *args: object, **kwargs: object) -> Response:
        serializer = ClaimRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not isinstance(user, User):
            raise NotFound()
        try:
            claim, created = create_claim(
                user=user,
                actor=user,
                idempotency_key=request.headers.get("Idempotency-Key", "")[:180],
                **serializer.validated_data,
            )
        except Payment.DoesNotExist as error:
            raise NotFound() from error
        except ValueError as error:
            raise ValidationError({"request": [str(error)]}) from error
        return Response(ClaimSerializer(claim).data, status=201 if created else 200)


class MyRefundClaimDetailsView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def patch(self, request: Request, claim_id: UUID) -> Response:
        class ContactSerializer(StrictSerializer):
            receiver_phone = serializers.RegexField(r"^(?:\+?218|0)?9[1-6][0-9]{7}$")

        serializer = ContactSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not isinstance(request.user, User):
            raise NotFound()
        try:
            claim = RefundClaim.objects.select_for_update().get(id=claim_id, user=request.user)
        except RefundClaim.DoesNotExist as error:
            raise NotFound() from error
        if claim.status not in {
            RefundClaim.Status.REQUESTED,
            RefundClaim.Status.NEEDS_INFO,
            RefundClaim.Status.APPROVED,
        }:
            raise ValidationError(
                {"request": ["Recipient changes need support review after approval."]}
            )
        claim.receiver_phone = serializer.validated_data["receiver_phone"]
        claim.save(update_fields=("receiver_phone", "updated_at"))
        return Response(ClaimSerializer(claim).data)


class FinanceRefundClaimsView(ListCreateAPIView[RefundClaim]):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.PAYMENTS_MANAGE
    serializer_class = ClaimSerializer
    queryset = RefundClaim.objects.select_related("payment", "user").all()

    def get_queryset(self):  # type: ignore[no-untyped-def]
        scope = self.request.query_params.get("scope", "open")
        if scope not in {"open", "all"}:
            raise ValidationError({"scope": ["Choose open or all requests."]})
        query = self.queryset
        return (
            query.filter(status__in=OPEN)
            if scope == "open"
            else query.order_by("-received_at", "-id")
        )

    @extend_schema(
        request=ExternalClaimSerializer, responses={200: ClaimSerializer, 201: ClaimSerializer}
    )
    def post(self, request: Request, *args: object, **kwargs: object) -> Response:
        serializer = ExternalClaimSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            payment = Payment.objects.select_related("account__primary_user").get(
                id=serializer.validated_data["payment_id"]
            )
            if not isinstance(request.user, User) or payment.account.primary_user is None:
                raise NotFound()
            claim, created = create_claim(
                user=payment.account.primary_user,
                actor=request.user,
                idempotency_key=request.headers.get("Idempotency-Key", "")[:180],
                **serializer.validated_data,
            )
        except Payment.DoesNotExist as error:
            raise NotFound() from error
        except ValueError as error:
            raise ValidationError({"request": [str(error)]}) from error
        return Response(ClaimSerializer(claim).data, status=201 if created else 200)


class FinanceRefundClaimReviewView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.PAYMENTS_MANAGE

    @extend_schema(request=ClaimReviewSerializer, responses=ClaimSerializer)
    def post(self, request: Request, claim_id: UUID) -> Response:
        serializer = ClaimReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not isinstance(request.user, User):
            raise NotFound()
        try:
            claim = review_claim(claim_id=claim_id, actor=request.user, **serializer.validated_data)
        except RefundClaim.DoesNotExist as error:
            raise NotFound() from error
        except ValueError as error:
            raise ValidationError({"request": [str(error)]}) from error
        return Response(ClaimSerializer(claim).data, status=status.HTTP_200_OK)

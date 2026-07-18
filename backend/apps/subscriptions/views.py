from uuid import UUID

from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.permissions import IsAdministrator

from .models import Subscription, SubscriptionTransition
from .selectors import current_subscription_for_user
from .serializers import AdminTransitionSerializer, SubscriptionSerializer
from .services import refresh_subscription, schedule_cancellation, transition_subscription


class CurrentSubscriptionView(APIView):
    def get(self, request: Request) -> Response:
        user = request.user
        if not isinstance(user, User):
            raise NotFound()
        subscription = current_subscription_for_user(user=user)
        if subscription is None:
            return Response({"subscription": None})
        subscription = refresh_subscription(subscription=subscription)
        return Response({"subscription": SubscriptionSerializer(subscription).data})


class CancelSubscriptionView(APIView):
    def post(self, request: Request) -> Response:
        user = request.user
        if not isinstance(user, User):
            raise NotFound()
        subscription = current_subscription_for_user(user=user)
        if subscription is None:
            raise NotFound("No subscription is available.")
        try:
            subscription = schedule_cancellation(subscription=subscription, user=user)
        except Subscription.DoesNotExist as error:
            raise ValidationError(
                {"subscription": ["This subscription cannot be cancelled."]}
            ) from error
        return Response(SubscriptionSerializer(subscription).data)


class AdminSubscriptionTransitionView(APIView):
    permission_classes = [IsAdministrator]

    def post(self, request: Request, subscription_id: UUID) -> Response:
        serializer = AdminTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actor = request.user
        if not isinstance(actor, User):
            raise NotFound()
        try:
            result = transition_subscription(
                subscription_id=subscription_id,
                to_status=str(serializer.validated_data["to_status"]),
                reason_code=str(serializer.validated_data["reason_code"]),
                source=SubscriptionTransition.Source.ADMIN,
                effective_at=timezone.now(),
                idempotency_key=request.headers.get("Idempotency-Key", "")[:180]
                or f"admin:{subscription_id}:{timezone.now().isoformat()}",
                actor=actor,
            )
        except (Subscription.DoesNotExist, ValueError) as error:
            raise ValidationError({"subscription": [str(error)]}) from error
        return Response(SubscriptionSerializer(result.subscription).data, status=status.HTTP_200_OK)

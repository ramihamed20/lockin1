from typing import cast
from uuid import uuid4

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AccountSession, User

from .models import Notification, PushDelivery, PushSubscription
from .push import configured, endpoint_hash, validate_subscription
from .serializers import PushEndpointSerializer, PushSubscriptionSerializer
from .services import create_notification


class PushSubscriptionView(APIView):
    def get(self, request: Request) -> Response:
        from django.conf import settings

        registered = PushSubscription.objects.filter(
            endpoint_hash=request.query_params.get("installation", ""),
            active=True,
            account_session__user=cast(User, request.user),
            account_session__session_key=request._request.session.session_key,
            account_session__expires_at__gt=timezone.now(),
        ).first()

        return Response(
            {
                "enabled": configured(),
                "registered": registered is not None,
                "binding": str(registered.binding) if registered else "",
                "public_key": settings.WEB_PUSH_VAPID_PUBLIC_KEY if configured() else "",
            }
        )

    @transaction.atomic
    def post(self, request: Request) -> Response:
        if not configured():
            raise ValidationError("Device notifications are not configured yet.")
        serializer = PushSubscriptionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = cast(User, request.user)
        if str(data["user_id"]) != str(user.id):
            raise PermissionDenied("The signed-in account changed. Refresh this page.")
        User.objects.select_for_update().only("id").get(pk=user.pk)
        try:
            info = validate_subscription(data["subscription"])
        except ValueError as error:
            raise ValidationError(str(error)) from error
        fingerprint = endpoint_hash(info["endpoint"])
        if (
            not PushSubscription.objects.filter(
                endpoint_hash=fingerprint, account_session__user=user
            ).exists()
            and PushSubscription.objects.filter(account_session__user=user, active=True).count()
            >= 10
        ):
            raise ValidationError("Remove a device before adding another one.")
        # Do not recreate a session revoked while this request was waiting.
        session = AccountSession.objects.filter(
            session_key=request._request.session.session_key,
            user=user,
            expires_at__gt=timezone.now(),
        ).first()
        if session is None:
            raise PermissionDenied("Sign in again to enable device notifications.")
        subscription, _ = PushSubscription.objects.get_or_create(
            endpoint_hash=fingerprint,
            defaults={"account_session": session, "subscription": info},
        )
        subscription = PushSubscription.objects.select_for_update().get(pk=subscription.pk)
        # A fresh binding also covers browsers reusing a repaired session row.
        subscription.binding = uuid4()
        subscription.account_session = session
        subscription.subscription = info
        subscription.locale = str(data["locale"])
        subscription.active = True
        subscription.save()
        return Response({"binding": str(subscription.binding)}, status=201)

    def delete(self, request: Request) -> Response:
        serializer = PushEndpointSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if str(data["user_id"]) != str(request.user.pk):
            raise PermissionDenied("The signed-in account changed.")
        endpoint = str(data["endpoint"])
        PushSubscription.objects.filter(
            endpoint_hash=endpoint_hash(endpoint), account_session__user=cast(User, request.user)
        ).delete()
        return Response(status=204)


class PushTestView(APIView):
    def post(self, request: Request) -> Response:
        serializer = PushEndpointSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = cast(User, request.user)
        if str(data["user_id"]) != str(user.id):
            raise PermissionDenied("The signed-in account changed.")
        endpoint = str(data["endpoint"])
        subscription = PushSubscription.objects.filter(
            endpoint_hash=endpoint_hash(endpoint),
            account_session__user=user,
            active=True,
            account_session__session_key=request._request.session.session_key,
            account_session__expires_at__gt=timezone.now(),
        ).first()
        if not configured() or subscription is None:
            raise PermissionDenied("Enable notifications on this device first.")
        notification, _ = create_notification(
            recipient_id=user.id,
            category=Notification.Category.PLATFORM,
            template_key="push.test",
            data={"push_installation": str(subscription.id)},
            title="Lock-in",
            body="هذا إشعار تجريبي من Lock-in."
            if subscription.locale == "ar"
            else "This is a test notification from Lock-in.",
            deduplication_key=f"push-test:{subscription.id}:{timezone.now():%Y%m%d%H%M}",
            target_route="/notifications",
        )
        queued = (
            notification is not None
            and PushDelivery.objects.filter(
                notification=notification,
                subscription=subscription,
                status__in=("pending", "sending", "accepted"),
            ).exists()
        )
        return Response({"queued": queued}, status=202)

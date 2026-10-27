"""Session-owned Web Push subscriptions and a bounded, durable delivery queue."""

import base64
import hashlib
import json
import time
from datetime import timedelta
from functools import lru_cache
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.conf import settings
from django.contrib.sessions.models import Session
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from pywebpush import WebPushException, webpush

from .models import (
    Notification,
    NotificationPreference,
    PushDelivery,
    PushSubscription,
    StudyReminder,
)

PUSH_HOSTS = (
    "fcm.googleapis.com",
    "android.googleapis.com",
    "push.services.mozilla.com",
    "push.apple.com",
    "notify.windows.com",
)


def configured() -> bool:
    return bool(
        settings.WEB_PUSH_ENABLED
        and _valid_keys(settings.WEB_PUSH_VAPID_PRIVATE_KEY, settings.WEB_PUSH_VAPID_PUBLIC_KEY)
    )


def _decode(value: str) -> bytes:
    return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)


@lru_cache(maxsize=8)
def _valid_keys(private: str, public: str) -> bool:
    try:
        key = serialization.load_der_private_key(_decode(private), password=None)
        return bool(
            isinstance(key, ec.EllipticCurvePrivateKey)
            and isinstance(key.curve, ec.SECP256R1)
            and key.public_key().public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
            )
            == _decode(public)
        )
    except (ValueError, TypeError):
        return False


def validate_subscription(value: Any) -> dict[str, Any]:
    """Only HTTPS browser push providers; never arbitrary user-supplied hosts."""
    if not isinstance(value, dict):
        raise ValueError("Invalid push subscription.")
    endpoint = value.get("endpoint")
    if not isinstance(endpoint, str) or len(endpoint) > 2048:
        raise ValueError("Invalid push endpoint.")
    parsed = urlsplit(endpoint)
    host = parsed.hostname or ""
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.fragment
        or parsed.port not in (None, 443)
        or not any(host == item or host.endswith("." + item) for item in PUSH_HOSTS)
    ):
        raise ValueError("Unsupported push provider.")
    keys = value.get("keys")
    if not isinstance(keys, dict):
        raise ValueError("Invalid push keys.")
    try:
        public, auth = str(keys["p256dh"]), str(keys["auth"])
        if len(public) > 100 or len(auth) > 30 or len(_decode(auth)) != 16:
            raise ValueError
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), _decode(public))
    except (KeyError, ValueError, TypeError) as error:
        raise ValueError("Invalid push keys.") from error
    return {"endpoint": endpoint, "keys": {"p256dh": public, "auth": auth}}


def endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode()).hexdigest()


def enqueue_push(notification: Notification) -> None:
    if not configured():
        return
    blocked = NotificationPreference.objects.filter(
        user_id=notification.recipient_id,
        category=notification.category,
        channel="push",
        enabled=False,
    ).exists()
    if blocked:
        return
    subscriptions = PushSubscription.objects.filter(
        active=True,
        account_session__user_id=notification.recipient_id,
        account_session__expires_at__gt=timezone.now(),
    )
    if notification.template_key == "push.test":
        subscriptions = subscriptions.filter(pk=notification.data.get("push_installation"))
    PushDelivery.objects.bulk_create(
        [PushDelivery(notification=notification, subscription=item) for item in subscriptions],
        ignore_conflicts=True,
    )


def dispatch_push(*, limit: int = 100, budget_seconds: float = 25) -> dict[str, int]:
    counts = {"accepted": 0, "retry": 0, "failed": 0, "cancelled": 0}
    if not configured():
        return counts
    started = time.monotonic()
    for _ in range(min(max(limit, 0), 1000)):
        if time.monotonic() - started >= budget_seconds:
            break
        now = timezone.now()
        with transaction.atomic():
            delivery = (
                PushDelivery.objects.select_for_update(skip_locked=True)
                .filter(
                    Q(status="pending", next_attempt_at__lte=now)
                    | Q(status="sending", locked_until__lt=now)
                )
                .order_by("next_attempt_at", "pk")
                .first()
            )
            if delivery is None:
                break
            if delivery.attempts >= 5:
                delivery.status = "failed"
                delivery.save(update_fields=("status",))
                counts["failed"] += 1
                continue
            delivery.status, delivery.lock_token = "sending", uuid4()
            delivery.locked_until = now + timedelta(minutes=2)
            delivery.attempts += 1
            delivery.save(update_fields=("status", "lock_token", "locked_until", "attempts"))
        delivery = (
            PushDelivery.objects.select_related(
                "notification", "subscription__account_session__user"
            )
            .filter(pk=delivery.pk)
            .first()
        )
        if delivery is None:
            counts["cancelled"] += 1
            continue
        subscription, notice = delivery.subscription, delivery.notification
        session = subscription.account_session
        status, error_code = "accepted", ""
        if (
            not subscription.active
            or not session.user.is_active
            or session.expires_at <= now
            or session.user_id != notice.recipient_id
            or notice.created_at < now - timedelta(days=1)
            or (
                notice.template_key == "study.reminder"
                and (
                    notice.created_at < now - timedelta(hours=2)
                    or not StudyReminder.objects.filter(
                        user_id=notice.recipient_id, enabled=True
                    ).exists()
                )
            )
            or not Session.objects.filter(
                session_key=session.session_key, expire_date__gt=now
            ).exists()
            or NotificationPreference.objects.filter(
                user_id=notice.recipient_id,
                category=notice.category,
                channel="push",
                enabled=False,
            ).exists()
        ):
            status = "cancelled"
        else:
            try:
                info = validate_subscription(subscription.subscription)
                # Do not follow even a trusted provider's redirect to another host.
                with requests.Session() as http:
                    http.max_redirects = 0
                    http.trust_env = False
                    webpush(
                        subscription_info=info,
                        data=json.dumps(
                            {
                                "id": str(notice.id),
                                "binding": str(subscription.binding),
                                "expires_at": session.expires_at.isoformat(),
                                "title": notice.title,
                                "body": notice.body,
                            },
                            ensure_ascii=False,
                        ),
                        vapid_private_key=settings.WEB_PUSH_VAPID_PRIVATE_KEY,
                        vapid_claims={"sub": settings.WEB_PUSH_CONTACT},
                        content_encoding="aes128gcm",
                        ttl=86400,
                        timeout=5,
                        requests_session=http,
                    )
            except WebPushException as error:
                code = error.response.status_code if error.response is not None else 0
                error_code = f"push_http_{code}" if code else "push_unreachable"
                if code in (404, 410):
                    PushSubscription.objects.filter(
                        pk=subscription.pk, binding=subscription.binding
                    ).update(active=False)
                    status = "failed"
                else:
                    status = "pending" if code in (0, 408, 429) or code >= 500 else "failed"
            except (requests.RequestException, ValueError):
                status, error_code = "pending", "push_transport_or_key_error"
        if status == "pending" and delivery.attempts >= 5:
            status = "failed"
        PushDelivery.objects.filter(
            pk=delivery.pk, lock_token=delivery.lock_token, status="sending"
        ).update(
            status=status,
            error_code=error_code,
            locked_until=None,
            lock_token=None,
            next_attempt_at=now + timedelta(seconds=min(60 * 2**delivery.attempts, 3600)),
        )
        counts["retry" if status == "pending" else status] += 1
    return counts

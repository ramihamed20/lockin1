import base64
import json
from datetime import timedelta
from unittest.mock import patch

import pytest
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from pywebpush import WebPushException
from rest_framework.test import APIClient

from apps.accounts.models import AccountSession
from apps.accounts.tests.helpers import create_user
from apps.notifications.models import (
    Notification,
    NotificationPreference,
    PushDelivery,
    PushSubscription,
)
from apps.notifications.push import configured, dispatch_push, endpoint_hash, validate_subscription
from apps.notifications.services import create_notification

pytestmark = pytest.mark.django_db


def encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


@pytest.fixture(autouse=True)
def keys():
    key = ec.generate_private_key(ec.SECP256R1())
    with override_settings(
        WEB_PUSH_ENABLED=True,
        WEB_PUSH_VAPID_PRIVATE_KEY=encode(
            key.private_bytes(
                serialization.Encoding.DER,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        ),
        WEB_PUSH_VAPID_PUBLIC_KEY=encode(
            key.public_key().public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
            )
        ),
    ):
        yield


def payload(user):
    key = ec.generate_private_key(ec.SECP256R1()).public_key()
    return {
        "user_id": str(user.id),
        "locale": "ar",
        "subscription": {
            "endpoint": "https://fcm.googleapis.com/fcm/send/opaque-endpoint",
            "keys": {
                "p256dh": encode(
                    key.public_bytes(
                        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
                    )
                ),
                "auth": encode(b"0123456789abcdef"),
            },
        },
    }


def tracked_client(user):
    client = APIClient()
    client.force_authenticate(user)
    session = client.session
    session.save()
    client.cookies["sessionid"] = session.session_key
    AccountSession.objects.create(
        user=user,
        session_key=session.session_key,
        device_label="Test",
        expires_at=timezone.now() + timedelta(days=1),
    )
    return client


def enroll():
    user = create_user()
    client = tracked_client(user)
    data = payload(user)
    response = client.post("/api/v1/notifications/push", data, format="json")
    assert response.status_code == 201, response.data
    return user, client, data


def notice(user, key="one"):
    return create_notification(
        recipient_id=user.id,
        category=Notification.Category.LEARNING,
        template_key="learning.test",
        title="New sheet",
        body="Ready to study",
        deduplication_key=key,
    )[0]


def test_opt_in_is_scoped_idempotent_and_configuration_hides_private_keys():
    user, client, data = enroll()
    assert client.post("/api/v1/notifications/push", data, format="json").status_code == 201
    assert PushSubscription.objects.count() == 1
    config = client.get("/api/v1/notifications/push").json()
    assert config["enabled"] and config["public_key"]
    assert set(config) == {"enabled", "public_key", "registered", "binding"}
    assert config["registered"] is False
    current = client.get(
        "/api/v1/notifications/push",
        {"installation": endpoint_hash(data["subscription"]["endpoint"])},
    ).json()
    assert current["registered"] is True
    assert current["binding"] == str(PushSubscription.objects.get().binding)
    client.force_authenticate(create_user(email="other@example.test"))
    assert client.post("/api/v1/notifications/push", data, format="json").status_code == 403
    assert (
        client.delete(
            "/api/v1/notifications/push",
            {"user_id": str(user.id), "endpoint": data["subscription"]["endpoint"]},
            format="json",
        ).status_code
        == 403
    )
    assert PushSubscription.objects.count() == 1
    client.force_authenticate(None)
    assert client.get("/api/v1/notifications/push").status_code in (401, 403)


def test_provider_endpoints_and_encryption_keys_reject_ssrf_and_malformed_inputs():
    user = create_user()
    data = payload(user)["subscription"]
    for url in (
        "http://fcm.googleapis.com/x",
        "https://127.0.0.1/",
        "https://fcm.googleapis.com.evil.test/",
        "https://user@fcm.googleapis.com/x",
        "https://fcm.googleapis.com:8080/x",
    ):
        with pytest.raises(ValueError):
            validate_subscription({**data, "endpoint": url})
    with pytest.raises(ValueError):
        validate_subscription({**data, "keys": {"p256dh": "bad", "auth": "bad"}})
    client = APIClient()
    client.force_authenticate(user)
    assert client.post("/api/v1/notifications/push", [], format="json").status_code == 400


def test_creation_only_enqueues_and_provider_work_is_outside_the_web_request():
    user, _, _ = enroll()
    with patch("apps.notifications.push.webpush") as send:
        first = notice(user)
        notice(user)
        send.assert_not_called()
        assert PushDelivery.objects.count() == 1
        assert dispatch_push()["accepted"] == 1
        sent = json.loads(send.call_args.kwargs["data"])
        assert sent["id"] == str(first.id)
        assert sent["binding"] == str(PushSubscription.objects.get().binding)
        assert sent["body"] == "Ready to study"
        assert send.call_args.kwargs["timeout"] == 5
        assert send.call_args.kwargs["requests_session"].max_redirects == 0
        dispatch_push()
        assert send.call_count == 1


def test_push_preferences_expired_sessions_and_deleted_sessions_stop_delivery():
    user, _, _ = enroll()
    NotificationPreference.objects.create(
        user=user, category="learning", channel="push", enabled=False
    )
    notice(user)
    assert not PushDelivery.objects.exists()
    NotificationPreference.objects.filter(user=user).delete()
    notice(user, "two")
    subscription = PushSubscription.objects.get()
    subscription.account_session.expires_at = timezone.now() - timedelta(seconds=1)
    subscription.account_session.save()
    with patch("apps.notifications.push.webpush") as send:
        assert dispatch_push()["cancelled"] == 1
        send.assert_not_called()
    subscription.account_session.delete()
    assert not PushSubscription.objects.exists()


def test_transient_failure_retries_but_expired_provider_disables_the_installation():
    user, _, _ = enroll()
    notice(user)
    with patch("apps.notifications.push.webpush", side_effect=requests.Timeout()):
        assert dispatch_push()["retry"] == 1
    delivery = PushDelivery.objects.get()
    assert delivery.status == "pending" and delivery.attempts == 1
    assert delivery.next_attempt_at > timezone.now()
    delivery.next_attempt_at = timezone.now()
    delivery.save()
    response = requests.Response()
    response.status_code = 410
    with patch(
        "apps.notifications.push.webpush", side_effect=WebPushException("gone", response=response)
    ):
        assert dispatch_push()["failed"] == 1
    assert not PushSubscription.objects.get().active


def test_rebinding_an_installation_cancels_the_old_accounts_queued_message():
    user, client, data = enroll()
    notice(user)
    original = PushSubscription.objects.get().binding
    other = create_user(email="new-owner@example.test")
    client = tracked_client(other)
    data["user_id"] = str(other.id)
    assert client.post("/api/v1/notifications/push", data, format="json").status_code == 201
    assert PushSubscription.objects.get().binding != original
    with patch("apps.notifications.push.webpush") as send:
        assert dispatch_push()["cancelled"] == 1
        send.assert_not_called()


def test_device_can_disable_and_request_a_deduplicated_test():
    user, client, data = enroll()
    endpoint = {"endpoint": data["subscription"]["endpoint"], "user_id": str(user.id)}
    for _ in range(2):
        assert (
            client.post("/api/v1/notifications/push/test", endpoint, format="json").status_code
            == 202
        )
    assert Notification.objects.filter(template_key="push.test").count() == 1
    assert client.delete("/api/v1/notifications/push", endpoint, format="json").status_code == 204
    assert not PushDelivery.objects.exists()


def test_disabled_or_mismatched_vapid_keys_fail_closed():
    user = create_user()
    with override_settings(WEB_PUSH_VAPID_PUBLIC_KEY="broken"):
        assert not configured()
        notice(user)
        assert not PushDelivery.objects.exists()
    with override_settings(WEB_PUSH_ENABLED=False):
        assert not configured()


def test_key_generator_writes_private_file_without_printing_or_overwriting_it(tmp_path):
    from io import StringIO

    from django.core.management import CommandError

    output = StringIO()
    path = tmp_path / "private.key"
    call_command("generate_web_push_keys", private_file=str(path), stdout=output)
    assert path.read_text().strip() not in output.getvalue()
    assert "WEB_PUSH_VAPID_PUBLIC_KEY=" in output.getvalue()
    assert path.stat().st_mode & 0o777 == 0o600
    with pytest.raises(CommandError):
        call_command("generate_web_push_keys", private_file=str(path))


def test_subscription_routes_preserve_session_csrf():
    user = create_user()
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)
    AccountSession.objects.create(
        user=user,
        session_key=client.session.session_key,
        device_label="Test",
        expires_at=timezone.now() + timedelta(days=1),
    )
    data = payload(user)
    assert client.post("/api/v1/notifications/push", data, format="json").status_code == 403
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    assert (
        client.post(
            "/api/v1/notifications/push", data, format="json", HTTP_X_CSRFTOKEN=csrf
        ).status_code
        == 201
    )


def test_exhausted_abandoned_claim_does_not_retry_forever():
    user, _, _ = enroll()
    notice(user)
    PushDelivery.objects.update(
        status="sending", locked_until=timezone.now() - timedelta(seconds=1), attempts=5
    )
    with patch("apps.notifications.push.webpush") as send:
        assert dispatch_push()["failed"] == 1
        send.assert_not_called()


def test_actual_webpush_encrypts_and_signs_without_contacting_a_provider():
    user, _, _ = enroll()
    notice(user)
    response = requests.Response()
    response.status_code = 202
    with patch("requests.Session.post", return_value=response) as post:
        assert dispatch_push()["accepted"] == 1
        assert b"Ready to study" not in post.call_args.kwargs["data"]
        assert post.call_args.kwargs["headers"]["content-encoding"] == "aes128gcm"
        assert "vapid " in post.call_args.kwargs["headers"]["Authorization"]


def test_revoked_session_cannot_be_recreated_by_subscribe():
    user, client, data = enroll()
    PushSubscription.objects.get().account_session.delete()
    assert client.post("/api/v1/notifications/push", data, format="json").status_code == 403
    assert not PushSubscription.objects.exists()


def test_deleted_django_session_cancels_a_still_tracked_installation():
    from django.contrib.sessions.models import Session

    user, _, _ = enroll()
    notice(user)
    Session.objects.filter(
        session_key=PushSubscription.objects.get().account_session.session_key
    ).delete()
    with patch("apps.notifications.push.webpush") as send:
        assert dispatch_push()["cancelled"] == 1
        send.assert_not_called()


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_concurrent_dispatchers_claim_one_message_once():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections

    user, _, _ = enroll()
    notice(user)
    entered, release = Event(), Event()

    def accept(**kwargs):
        entered.set()
        assert release.wait(timeout=10)

    def dispatch():
        close_old_connections()
        try:
            return dispatch_push(limit=1)
        finally:
            close_old_connections()

    with patch("apps.notifications.push.webpush", side_effect=accept) as send:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(dispatch)
            assert entered.wait(timeout=10)
            second = pool.submit(dispatch)
            assert second.result(timeout=10)["accepted"] == 0
            release.set()
            assert first.result(timeout=10)["accepted"] == 1
        assert send.call_count == 1


def test_unicode_notifications_fit_the_push_payload_limit():
    user, _, _ = enroll()
    item = notice(user)
    item.title = "📚" * 160
    item.body = "🦷" * 320
    item.save()
    with patch("apps.notifications.push.webpush") as send:
        assert dispatch_push()["accepted"] == 1
        encoded = send.call_args.kwargs["data"]
        assert len(encoded.encode("utf-8")) < 3500
        assert json.loads(encoded)["body"] == item.body

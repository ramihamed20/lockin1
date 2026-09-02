import base64
import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from django.core.exceptions import ImproperlyConfigured
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.payments.recharge_codes import (
    RechargeCodeError,
    decrypt_recharge_code,
    encrypt_recharge_code,
    normalize_recharge_code,
    recharge_code_digest,
)
from apps.payments.telegram import ManualPaymentTelegramMessage, notify_manual_payment
from apps.product_catalog.models import Plan, Price
from apps.subscriptions.services import create_trial_for_user

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def manual_payment_settings(settings):  # type: ignore[no-untyped-def]
    settings.PAYMENT_CODE_ENCRYPTION_KEY = base64.urlsafe_b64encode(b"b" * 32).decode()
    settings.TELEGRAM_BOT_TOKEN = ""
    settings.TELEGRAM_PAYMENT_CHAT_ID = ""


def _user_and_plan(email: str = "manual-edge@example.com"):
    user = create_user(email=email, username=email.split("@", 1)[0].replace("-", "_"))
    create_trial_for_user(user=user, source_reference="manual-edge")
    return user, Plan.objects.get(code="lockin_monthly")


def test_recharge_crypto_normalizes_round_trips_and_rejects_tampering(settings) -> None:  # type: ignore[no-untyped-def]
    assert normalize_recharge_code(" 1234-5678 9012 ") == "123456789012"
    encrypted = encrypt_recharge_code("1234 5678 9012")
    assert decrypt_recharge_code(encrypted) == "123456789012"
    assert recharge_code_digest("1234-5678-9012") == recharge_code_digest("123456789012")
    for invalid in ("123", "1234567x", "١٢٣٤٥٦٧٨"):
        with pytest.raises(RechargeCodeError):
            normalize_recharge_code(invalid)
    with pytest.raises(RechargeCodeError):
        decrypt_recharge_code("v2.invalid")
    with pytest.raises(RechargeCodeError):
        decrypt_recharge_code(encrypted[:-3] + "bad")

    settings.ENVIRONMENT = "production"
    settings.PAYMENT_CODE_ENCRYPTION_KEY = ""
    with pytest.raises(ImproperlyConfigured):
        recharge_code_digest("12345678")


def test_telegram_adapter_is_optional_successful_and_best_effort(settings) -> None:  # type: ignore[no-untyped-def]
    message = ManualPaymentTelegramMessage(
        payment_id="pay-1",
        plan="Monthly",
        amount="10 LYD",
        submitted="2026-08-29T10:00:00Z",
    )
    rendered = message.render()
    assert "New Lock-in Payment" in rendered
    assert "Password" not in rendered
    assert "user-1" not in rendered
    assert "student_one" not in rendered
    assert "123456789012" not in rendered
    assert "Recharge Code" not in rendered
    assert notify_manual_payment(message) is False

    settings.TELEGRAM_BOT_TOKEN = "token"
    settings.TELEGRAM_PAYMENT_CHAT_ID = "chat"
    response = MagicMock()
    response.status = 200
    response.__enter__.return_value.status = 200
    with patch("apps.payments.telegram.urlopen", return_value=response) as opened:
        assert notify_manual_payment(message) is True
    request = opened.call_args.args[0]
    payload = json.loads(request.data.decode())
    assert payload == {"chat_id": "chat", "text": rendered}

    with patch("apps.payments.telegram.urlopen", side_effect=TimeoutError):
        assert notify_manual_payment(message) is False


def test_manual_payment_idempotency_history_invalid_plan_and_rate_limit(settings) -> None:  # type: ignore[no-untyped-def]
    user, plan = _user_and_plan()
    client = APIClient()
    client.force_authenticate(user)
    payload = {"plan_id": str(plan.id), "recharge_code": "333344445555"}
    first = client.post(
        "/api/v1/payments/manual-libyana",
        payload,
        format="json",
        HTTP_IDEMPOTENCY_KEY="edge-idempotency-key-001",
    )
    replay = client.post(
        "/api/v1/payments/manual-libyana",
        payload,
        format="json",
        HTTP_IDEMPOTENCY_KEY="edge-idempotency-key-001",
    )
    history = client.get("/api/v1/payments")
    invalid_plan = client.post(
        "/api/v1/payments/manual-libyana",
        {"plan_id": str(uuid4()), "recharge_code": "999988887777"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="edge-invalid-plan-key-001",
    )

    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json()["payment"]["id"] == first.json()["payment"]["id"]
    assert history.status_code == 200
    assert history.json()["results"][0]["id"] == first.json()["payment"]["id"]
    assert invalid_plan.status_code == 400

    settings.MANUAL_PAYMENT_RATE_LIMIT = 0
    limited_user, _ = _user_and_plan("rate-limited@example.com")
    client.force_authenticate(limited_user)
    limited = client.post(
        "/api/v1/payments/manual-libyana",
        {"plan_id": str(plan.id), "recharge_code": "888877776666"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="edge-rate-limit-key-001",
    )
    assert limited.status_code == 429
    assert limited.json()["code"] == "rate_limited"


def test_telegram_submission_failure_never_rolls_back_payment(
    django_capture_on_commit_callbacks,
) -> None:  # type: ignore[no-untyped-def]
    user, plan = _user_and_plan("telegram-failure@example.com")
    client = APIClient()
    client.force_authenticate(user)
    with (
        patch("apps.payments.manual_services.notify_manual_payment", return_value=False) as notify,
        django_capture_on_commit_callbacks(execute=True),
    ):
        response = client.post(
            "/api/v1/payments/manual-libyana",
            {"plan_id": str(plan.id), "recharge_code": "666655554444"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="telegram-failure-key-001",
        )
    assert response.status_code == 201
    notify.assert_called_once()
    message = notify.call_args.args[0]
    rendered = message.render()
    assert user.email not in rendered
    assert str(user.id) not in rendered
    assert "666655554444" not in rendered


def test_gateway_payment_intent_remains_a_separate_provider_adapter() -> None:
    user = create_user(email="gateway-adapter@example.com", username="gateway_adapter")
    plan = Plan.objects.select_related("current_version").get(code="lockin_monthly")
    assert plan.current_version is not None
    price = Price.objects.create(
        plan_version=plan.current_version,
        code="gateway-adapter-usd",
        amount_minor=799,
        currency="USD",
        currency_exponent=2,
        interval=Price.Interval.MONTH,
        interval_count=1,
        status=Price.Status.ACTIVE,
    )
    client = APIClient()
    client.force_authenticate(user)
    missing_key = client.post(
        "/api/v1/payments/intents", {"price_id": str(price.id)}, format="json"
    )
    assert missing_key.status_code == 400

    checkout = {"provider": "future-gateway", "checkout_url": "https://pay.example/session"}
    with patch("apps.payments.views.create_checkout_session", return_value=checkout):
        first = client.post(
            "/api/v1/payments/intents",
            {"price_id": str(price.id)},
            format="json",
            HTTP_IDEMPOTENCY_KEY="gateway-adapter-key-001",
        )
        replay = client.post(
            "/api/v1/payments/intents",
            {"price_id": str(price.id)},
            format="json",
            HTTP_IDEMPOTENCY_KEY="gateway-adapter-key-001",
        )
    assert first.status_code == 201
    assert replay.status_code == 200
    assert first.json()["checkout"] == checkout

    invalid = client.post(
        "/api/v1/payments/intents",
        {"price_id": str(uuid4())},
        format="json",
        HTTP_IDEMPOTENCY_KEY="gateway-invalid-price-001",
    )
    assert invalid.status_code == 400

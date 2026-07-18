import hashlib
import hmac
import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from django.conf import settings


class ProviderVerificationError(ValueError):
    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class NormalizedProviderEvent:
    external_event_id: str
    event_type: str
    occurred_at: datetime
    data: dict[str, object]


class PaymentProvider(Protocol):
    code: str

    def create_checkout(self, *, payment_id: str) -> dict[str, object]: ...

    def create_refund(self, *, refund_id: str) -> dict[str, object]: ...

    def verify_webhook(
        self, *, raw_body: bytes, headers: Mapping[str, str]
    ) -> NormalizedProviderEvent: ...


class DisabledProvider:
    code = "none"

    def create_checkout(self, *, payment_id: str) -> dict[str, object]:
        raise ValueError("Checkout is not available because no payment provider is configured.")

    def create_refund(self, *, refund_id: str) -> dict[str, object]:
        raise ValueError(
            "Refund processing is not available because no payment provider is configured."
        )

    def verify_webhook(
        self, *, raw_body: bytes, headers: Mapping[str, str]
    ) -> NormalizedProviderEvent:
        raise ProviderVerificationError("Payment provider is disabled.", code="provider_disabled")


class FakeDevelopmentProvider:
    """Deterministic development adapter; production settings reject this provider."""

    code = "fake"
    _allowed_types = {
        "payment.succeeded",
        "payment.failed",
        "refund.succeeded",
        "refund.failed",
    }

    def create_checkout(self, *, payment_id: str) -> dict[str, object]:
        reference = f"fake_payment_{payment_id}"
        return {"provider": self.code, "reference": reference, "status": "pending"}

    def create_refund(self, *, refund_id: str) -> dict[str, object]:
        reference = f"fake_refund_{refund_id}"
        return {"provider": self.code, "reference": reference, "status": "pending"}

    def verify_webhook(
        self, *, raw_body: bytes, headers: Mapping[str, str]
    ) -> NormalizedProviderEvent:
        timestamp_text = headers.get("X-Lockin-Timestamp", "")
        signature = headers.get("X-Lockin-Signature", "")
        try:
            timestamp = int(timestamp_text)
        except ValueError as error:
            raise ProviderVerificationError(
                "Invalid webhook timestamp.", code="bad_timestamp"
            ) from error
        now = int(datetime.now(UTC).timestamp())
        if abs(now - timestamp) > settings.PAYMENT_WEBHOOK_TOLERANCE_SECONDS:
            raise ProviderVerificationError(
                "Webhook timestamp is outside the accepted window.", code="stale_timestamp"
            )
        secret = settings.PAYMENT_FAKE_WEBHOOK_SECRET.encode("utf-8")
        expected = hmac.new(
            secret, timestamp_text.encode("ascii") + b"." + raw_body, hashlib.sha256
        ).hexdigest()
        if not signature or not hmac.compare_digest(signature, expected):
            raise ProviderVerificationError("Webhook signature is invalid.", code="bad_signature")
        try:
            payload = json.loads(raw_body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ProviderVerificationError(
                "Webhook body is not valid JSON.", code="bad_json"
            ) from error
        if not isinstance(payload, dict):
            raise ProviderVerificationError("Webhook body must be an object.", code="bad_schema")
        event_id = payload.get("id")
        event_type = payload.get("type")
        occurred_at = payload.get("occurred_at")
        data = payload.get("data")
        if (
            not isinstance(event_id, str)
            or not 8 <= len(event_id) <= 180
            or event_type not in self._allowed_types
            or not isinstance(occurred_at, str)
            or not isinstance(data, dict)
        ):
            raise ProviderVerificationError("Webhook schema is invalid.", code="bad_schema")
        try:
            occurred = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
            if occurred.tzinfo is None:
                raise ValueError
        except ValueError as error:
            raise ProviderVerificationError(
                "Webhook occurrence time is invalid.", code="bad_schema"
            ) from error
        object_id = data.get("object_id")
        amount_minor = data.get("amount_minor")
        currency = data.get("currency")
        failure_code = data.get("failure_code", "")
        if (
            not isinstance(object_id, str)
            or not 1 <= len(object_id) <= 180
            or not isinstance(amount_minor, int)
            or isinstance(amount_minor, bool)
            or amount_minor <= 0
            or not isinstance(currency, str)
            or len(currency) != 3
            or not currency.isalpha()
            or not isinstance(failure_code, str)
        ):
            raise ProviderVerificationError("Webhook data is invalid.", code="bad_schema")
        normalized = {
            "object_id": object_id,
            "amount_minor": amount_minor,
            "currency": currency.upper(),
            "failure_code": failure_code[:80],
        }
        return NormalizedProviderEvent(
            external_event_id=event_id,
            event_type=str(event_type),
            occurred_at=occurred,
            data=normalized,
        )


def configured_provider() -> PaymentProvider:
    provider = settings.PAYMENT_PROVIDER
    if provider == "fake":
        if len(settings.PAYMENT_FAKE_WEBHOOK_SECRET) < 24:
            raise ValueError("The fake provider requires a strong development webhook secret.")
        return FakeDevelopmentProvider()
    if provider == "none":
        return DisabledProvider()
    raise ValueError("Configured payment provider is not supported by this deployment.")

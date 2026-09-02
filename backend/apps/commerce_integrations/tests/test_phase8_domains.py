import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from django.conf import settings
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.events import UserEmailVerified
from apps.accounts.tests.helpers import create_user
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant, PlanEntitlementRule
from apps.entitlements.services import entitlement_decision
from apps.invoices.models import Invoice
from apps.notifications.models import Notification, NotificationPreference
from apps.notifications.services import set_preferences
from apps.payments.models import Payment, PaymentTransition
from apps.payments.services import apply_successful_refund
from apps.product_catalog.models import Plan, Price, Product
from apps.product_catalog.services import (
    create_plan_version,
    create_price,
    publish_plan_version,
    publish_price,
)
from apps.provider_integrations.models import ProviderEvent, WebhookAttempt
from apps.subscriptions.models import Subscription, SubscriptionAccount
from platform_core.events import domain_events

pytestmark = pytest.mark.django_db


@override_settings(PAYMENT_PROVIDER="none")
def test_webhook_surface_is_closed_without_a_configured_provider() -> None:
    client = APIClient()
    response = client.post(
        "/api/v1/billing/webhooks/fake",
        data=b"{}",
        content_type="application/json",
    )
    assert response.status_code == 404
    assert not WebhookAttempt.objects.exists()


def _published_price(*, amount_minor: int = 3_500, currency: str = "USD") -> Price:
    plan = Plan.objects.select_related("current_version").get(code="lockin_trial")
    assert plan.current_version is not None
    price = create_price(
        plan_version=plan.current_version,
        code=f"test_{currency.lower()}_{amount_minor}",
        amount_minor=amount_minor,
        currency=currency,
        interval=Price.Interval.MONTH,
    )
    return publish_price(price=price)


def _start_payment(
    *, client: APIClient, price: Price, key: str = "checkout-stable-0001"
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/payments/intents",
        {"price_id": str(price.id)},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )
    assert response.status_code == 201
    return cast(dict[str, Any], response.json())


def _signed_webhook(
    *,
    event_id: str,
    event_type: str,
    object_id: str,
    amount_minor: int,
    currency: str,
    occurred_at: datetime | None = None,
    timestamp: int | None = None,
    failure_code: str = "",
) -> tuple[bytes, int, str]:
    occurred = occurred_at or timezone.now()
    body = json.dumps(
        {
            "id": event_id,
            "type": event_type,
            "occurred_at": occurred.isoformat(),
            "data": {
                "object_id": object_id,
                "amount_minor": amount_minor,
                "currency": currency,
                "failure_code": failure_code,
            },
        },
        separators=(",", ":"),
    ).encode()
    sent_at = timestamp or int(datetime.now(UTC).timestamp())
    signature = hmac.new(
        settings.PAYMENT_FAKE_WEBHOOK_SECRET.encode(),
        str(sent_at).encode("ascii") + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    return body, sent_at, signature


def _post_webhook(client: APIClient, signed: tuple[bytes, int, str]) -> Any:
    body, timestamp, signature = signed
    return client.post(
        "/api/v1/billing/webhooks/fake",
        data=body,
        content_type="application/json",
        HTTP_X_LOCKIN_TIMESTAMP=str(timestamp),
        HTTP_X_LOCKIN_SIGNATURE=signature,
    )


def _settled_payment(
    *, client: APIClient, django_capture_on_commit_callbacks: Any
) -> tuple[Payment, dict[str, Any]]:
    price = _published_price()
    intent = _start_payment(client=client, price=price)
    payment_id = intent["payment"]["id"]
    signed = _signed_webhook(
        event_id=f"evt-payment-{payment_id}",
        event_type="payment.succeeded",
        object_id=intent["checkout"]["reference"],
        amount_minor=price.amount_minor,
        currency=price.currency,
    )
    with django_capture_on_commit_callbacks(execute=True):
        response = _post_webhook(client, signed)
    assert response.status_code == 200
    return Payment.objects.get(id=payment_id), intent


def test_verified_event_creates_one_trial_and_server_owned_entitlements(
    django_capture_on_commit_callbacks: Any,
) -> None:
    user = create_user()
    assert user.email_verified_at is not None
    event = UserEmailVerified(
        user_id=user.id,
        actor_id=user.id,
        occurred_at=user.email_verified_at,
    )

    with django_capture_on_commit_callbacks(execute=True):
        domain_events.publish(event)
        domain_events.publish(event)

    subscription = Subscription.objects.get(account__primary_user=user)
    assert subscription.status == Subscription.Status.TRIALING
    assert SubscriptionAccount.objects.filter(primary_user=user).count() == 1
    assert EntitlementGrant.objects.filter(user=user, status="active").count() == 3
    assert entitlement_decision(user=user, entitlement_code="focus.workspace").allowed is True
    assert entitlement_decision(user=user, entitlement_code="ai.assistance").allowed is False
    assert Notification.objects.filter(
        recipient=user, category=Notification.Category.BILLING
    ).exists()


def test_payment_intent_uses_catalog_amount_and_is_idempotent() -> None:
    user = create_user()
    price = _published_price(amount_minor=4_900, currency="eur")
    client = APIClient()
    client.force_authenticate(user)

    rejected = client.post(
        "/api/v1/payments/intents",
        {"price_id": str(price.id), "amount_minor": 1, "currency": "XXX"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="checkout-rejected-0001",
    )

    first = _start_payment(client=client, price=price)
    repeated = client.post(
        "/api/v1/payments/intents",
        {"price_id": str(price.id)},
        format="json",
        HTTP_IDEMPOTENCY_KEY="checkout-stable-0001",
    )

    assert rejected.status_code == 400
    assert repeated.status_code == 200
    assert repeated.json()["payment"]["id"] == first["payment"]["id"]
    payment = Payment.objects.get(id=first["payment"]["id"])
    assert payment.amount_minor == 4_900
    assert payment.currency == "EUR"
    assert Payment.objects.filter(account__primary_user=user).count() == 1


def test_signed_payment_webhook_activates_access_and_is_duplicate_safe(
    django_capture_on_commit_callbacks: Any,
) -> None:
    user = create_user()
    client = APIClient()
    client.force_authenticate(user)
    payment, intent = _settled_payment(
        client=client, django_capture_on_commit_callbacks=django_capture_on_commit_callbacks
    )

    payment.refresh_from_db()
    subscription = payment.subscription
    subscription.refresh_from_db()
    assert payment.status == Payment.Status.SUCCEEDED
    assert subscription.status == Subscription.Status.ACTIVE
    assert subscription.current_period_ends_at is not None
    assert Invoice.objects.filter(payment=payment, status=Invoice.Status.PAID).count() == 1
    assert (
        EntitlementGrant.objects.filter(
            user=user, source_id=subscription.id, status=EntitlementGrant.Status.ACTIVE
        ).count()
        == 3
    )

    event = ProviderEvent.objects.get(event_type="payment.succeeded")
    repeated = _signed_webhook(
        event_id=event.external_event_id,
        event_type=event.event_type,
        object_id=intent["checkout"]["reference"],
        amount_minor=payment.amount_minor,
        currency=payment.currency,
        occurred_at=event.occurred_at,
    )
    with django_capture_on_commit_callbacks(execute=True):
        response = _post_webhook(client, repeated)
    assert response.status_code == 200
    assert response.json()["duplicate"] is True
    assert PaymentTransition.objects.filter(payment=payment, to_status="succeeded").count() == 1
    assert Invoice.objects.filter(payment=payment).count() == 1


def test_invalid_stale_and_conflicting_webhooks_are_audited(
    django_capture_on_commit_callbacks: Any,
) -> None:
    user = create_user()
    price = _published_price()
    client = APIClient()
    client.force_authenticate(user)
    intent = _start_payment(client=client, price=price)
    signed = _signed_webhook(
        event_id="evt-security-0001",
        event_type="payment.succeeded",
        object_id=intent["checkout"]["reference"],
        amount_minor=price.amount_minor,
        currency=price.currency,
    )
    body, timestamp, _ = signed
    invalid = client.post(
        "/api/v1/billing/webhooks/fake",
        data=body,
        content_type="application/json",
        HTTP_X_LOCKIN_TIMESTAMP=str(timestamp),
        HTTP_X_LOCKIN_SIGNATURE="0" * 64,
    )
    assert invalid.status_code == 400
    assert WebhookAttempt.objects.filter(failure_code="bad_signature").exists()

    stale = _signed_webhook(
        event_id="evt-security-stale",
        event_type="payment.succeeded",
        object_id=intent["checkout"]["reference"],
        amount_minor=price.amount_minor,
        currency=price.currency,
        timestamp=int(datetime.now(UTC).timestamp()) - 1_000,
    )
    assert _post_webhook(client, stale).status_code == 400
    assert WebhookAttempt.objects.filter(failure_code="stale_timestamp").exists()

    oversized = client.post(
        "/api/v1/billing/webhooks/fake",
        data=b"x" * (settings.PAYMENT_WEBHOOK_MAX_BYTES + 1),
        content_type="application/json",
        HTTP_X_LOCKIN_TIMESTAMP=str(timestamp),
        HTTP_X_LOCKIN_SIGNATURE="0" * 64,
    )
    assert oversized.status_code == 413

    with django_capture_on_commit_callbacks(execute=True):
        assert _post_webhook(client, signed).status_code == 200
    conflict = _signed_webhook(
        event_id="evt-security-0001",
        event_type="payment.succeeded",
        object_id=intent["checkout"]["reference"],
        amount_minor=price.amount_minor + 1,
        currency=price.currency,
    )
    assert _post_webhook(client, conflict).status_code == 400
    assert ProviderEvent.objects.filter(external_event_id="evt-security-0001").count() == 1


def test_verified_amount_mismatch_cannot_change_payment(
    django_capture_on_commit_callbacks: Any,
) -> None:
    user = create_user()
    price = _published_price()
    client = APIClient()
    client.force_authenticate(user)
    intent = _start_payment(client=client, price=price)
    signed = _signed_webhook(
        event_id="evt-mismatch-0001",
        event_type="payment.succeeded",
        object_id=intent["checkout"]["reference"],
        amount_minor=price.amount_minor + 500,
        currency=price.currency,
    )
    with django_capture_on_commit_callbacks(execute=True):
        response = _post_webhook(client, signed)

    assert response.status_code == 200
    payment = Payment.objects.get(id=intent["payment"]["id"])
    event = ProviderEvent.objects.get(external_event_id="evt-mismatch-0001")
    assert payment.status == Payment.Status.INITIATED
    assert event.status == ProviderEvent.Status.FAILED
    assert "does not match" in event.processing_error


def test_full_refund_revokes_paid_access_only_after_provider_confirmation(
    django_capture_on_commit_callbacks: Any,
) -> None:
    student = create_user()
    admin = create_user(email="admin@example.com", is_superuser=True, is_staff=True)
    student_client = APIClient()
    student_client.force_authenticate(student)
    payment, _ = _settled_payment(
        client=student_client,
        django_capture_on_commit_callbacks=django_capture_on_commit_callbacks,
    )
    admin_client = APIClient()
    admin_client.force_authenticate(admin)

    requested = admin_client.post(
        "/api/v1/admin/refunds",
        {
            "payment_id": str(payment.id),
            "amount_minor": payment.amount_minor,
            "reason": "Duplicate charge confirmed by support",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="refund-stable-0001",
    )
    assert requested.status_code == 201
    refund_id = requested.json()["id"]
    payment.refresh_from_db()
    assert payment.status == Payment.Status.SUCCEEDED

    signed = _signed_webhook(
        event_id=f"evt-refund-{refund_id}",
        event_type="refund.succeeded",
        object_id=f"fake_refund_{refund_id}",
        amount_minor=payment.amount_minor,
        currency=payment.currency,
    )
    with django_capture_on_commit_callbacks(execute=True):
        response = _post_webhook(admin_client, signed)
    assert response.status_code == 200

    payment.refresh_from_db()
    subscription = payment.subscription
    subscription.refresh_from_db()
    invoice = Invoice.objects.get(payment=payment)
    assert payment.status == Payment.Status.REFUNDED
    assert invoice.status == Invoice.Status.REFUNDED
    assert subscription.status == Subscription.Status.REFUNDED
    assert not EntitlementGrant.objects.filter(
        user=student, source_id=subscription.id, status=EntitlementGrant.Status.ACTIVE
    ).exists()
    repeated = apply_successful_refund(
        payment_id=payment.id,
        amount_minor=payment.amount_minor,
        refund_id=UUID(refund_id),
    )
    assert repeated.status == Payment.Status.REFUNDED


def test_refund_reservations_prevent_over_refunding(
    django_capture_on_commit_callbacks: Any,
) -> None:
    student = create_user()
    admin = create_user(email="refund-admin@example.com", is_superuser=True, is_staff=True)
    student_client = APIClient()
    student_client.force_authenticate(student)
    payment, _ = _settled_payment(
        client=student_client,
        django_capture_on_commit_callbacks=django_capture_on_commit_callbacks,
    )
    client = APIClient()
    client.force_authenticate(admin)
    payload = {
        "payment_id": str(payment.id),
        "amount_minor": payment.amount_minor - 100,
        "reason": "Partial adjustment approved",
    }
    assert (
        client.post(
            "/api/v1/admin/refunds",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="refund-reserve-0001",
        ).status_code
        == 201
    )
    second = client.post(
        "/api/v1/admin/refunds",
        {**payload, "amount_minor": 101},
        format="json",
        HTTP_IDEMPOTENCY_KEY="refund-reserve-0002",
    )
    assert second.status_code == 400


def test_billing_apis_are_private_and_owner_scoped() -> None:
    first = create_user()
    second = create_user(email="second@example.com")
    price = _published_price()
    client = APIClient()
    client.force_authenticate(first)
    intent = _start_payment(client=client, price=price)

    anonymous = APIClient()
    assert anonymous.get("/api/v1/payments").status_code in (401, 403)
    client.force_authenticate(second)
    assert client.get("/api/v1/payments").json()["results"] == []
    assert client.get("/api/v1/refunds").json()["results"] == []
    assert client.get("/api/v1/invoices").json()["results"] == []
    assert not Payment.objects.filter(
        id=intent["payment"]["id"], account__primary_user=second
    ).exists()


def test_billing_notifications_cannot_be_disabled() -> None:
    user = create_user()
    with pytest.raises(ValueError, match="cannot be disabled"):
        set_preferences(
            user=user,
            preferences=[
                {
                    "category": Notification.Category.BILLING,
                    "channel": NotificationPreference.Channel.IN_APP,
                    "enabled": False,
                }
            ],
        )


def test_reconciliation_expires_overdue_trial_and_revokes_access() -> None:
    user = create_user()
    plan = Plan.objects.select_related("current_version").get(code="lockin_trial")
    assert plan.current_version is not None
    account = SubscriptionAccount.objects.create(
        kind=SubscriptionAccount.Kind.INDIVIDUAL,
        primary_user=user,
        display_name=user.full_name,
    )
    ended = timezone.now() - timedelta(days=1)
    subscription = Subscription.objects.create(
        account=account,
        plan_version=plan.current_version,
        status=Subscription.Status.TRIALING,
        started_at=ended - timedelta(days=30),
        trial_started_at=ended - timedelta(days=30),
        trial_ends_at=ended,
        current_period_started_at=ended - timedelta(days=30),
        current_period_ends_at=ended,
    )
    call_command("reconcile_commerce")
    subscription.refresh_from_db()
    assert subscription.status == Subscription.Status.EXPIRED
    assert entitlement_decision(user=user, entitlement_code="focus.workspace").allowed is False


def test_current_plan_entitlement_and_cancellation_apis_use_authoritative_state(
    django_capture_on_commit_callbacks: Any,
) -> None:
    user = create_user()
    assert user.email_verified_at is not None
    with django_capture_on_commit_callbacks(execute=True):
        domain_events.publish(
            UserEmailVerified(
                user_id=user.id,
                actor_id=user.id,
                occurred_at=user.email_verified_at,
            )
        )
    client = APIClient()
    client.force_authenticate(user)

    current = client.get("/api/v1/subscriptions/current")
    grants = client.get("/api/v1/entitlements/me")
    focus = client.get("/api/v1/entitlements/me/focus.workspace")
    ai = client.get("/api/v1/entitlements/me/ai.assistance")
    cancelled = client.post("/api/v1/subscriptions/current/cancel")

    assert current.status_code == 200
    assert current.json()["subscription"]["status"] == "trialing"
    assert len(grants.json()["results"]) == 3
    assert focus.json()["allowed"] is True
    assert ai.json()["allowed"] is False
    assert cancelled.status_code == 200
    assert cancelled.json()["cancel_at_period_end"] is True

    no_plan = create_user(email="no-plan@example.com")
    client.force_authenticate(no_plan)
    assert client.get("/api/v1/subscriptions/current").json() == {"subscription": None}


def test_administrator_can_grant_auditable_manual_entitlement() -> None:
    user = create_user()
    admin = create_user(email="grant-admin@example.com", is_superuser=True, is_staff=True)
    client = APIClient()
    client.force_authenticate(admin)
    now = timezone.now()
    payload = {
        "user_id": str(user.id),
        "entitlement_code": "ai.assistance",
        "source_id": str(uuid4()),
        "starts_at": now.isoformat(),
        "ends_at": (now + timedelta(days=2)).isoformat(),
        "reason_code": "support_approval",
    }

    created = client.post("/api/v1/entitlements/admin/grants", payload, format="json")
    repeated = client.post("/api/v1/entitlements/admin/grants", payload, format="json")

    assert created.status_code == 201
    assert repeated.status_code == 200
    assert entitlement_decision(user=user, entitlement_code="ai.assistance").allowed is True


def test_catalog_versions_are_immutable_offers_and_expose_currency_precision() -> None:
    product = Product.objects.create(
        code="lockin_test_catalog",
        title="Lock-in test catalog",
        status=Product.Status.DRAFT,
    )
    version = create_plan_version(
        product=product,
        plan_code="student_plus",
        title="Student Plus",
        trial_days=7,
        grace_days=2,
    )
    with pytest.raises(ValueError, match="At least one entitlement"):
        publish_plan_version(plan_version=version)
    PlanEntitlementRule.objects.create(
        plan_version=version,
        entitlement=EntitlementDefinition.objects.get(code="content.premium"),
    )
    publish_plan_version(plan_version=version)
    price = create_price(
        plan_version=version,
        code="student_plus_bhd",
        amount_minor=1_234,
        currency="bhd",
        currency_exponent=3,
        interval=Price.Interval.MONTH,
        region_code="bh",
    )
    publish_price(price=price)

    client = APIClient()
    client.force_authenticate(create_user())
    response = client.get("/api/v1/catalog/products?region=BH")
    payload = response.json()
    matching = next(item for item in payload["results"] if item["code"] == product.code)

    assert response.status_code == 200
    assert matching["plans"][0]["current_version"]["version"] == 1
    assert matching["plans"][0]["current_version"]["prices"][0]["currency_exponent"] == 3
    with pytest.raises(ValueError, match="exponent"):
        create_price(
            plan_version=version,
            code="invalid_precision",
            amount_minor=10,
            currency="USD",
            currency_exponent=5,
            interval=Price.Interval.MONTH,
        )

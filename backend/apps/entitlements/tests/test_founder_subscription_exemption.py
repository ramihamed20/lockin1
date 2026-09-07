import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.entitlements.services import entitlement_decision, sync_subscription_entitlements
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import create_trial_for_user

pytestmark = pytest.mark.django_db


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def _expire_subscription(user):
    subscription, _ = create_trial_for_user(user=user, source_reference="founder-exemption")
    subscription.status = Subscription.Status.EXPIRED
    subscription.save(update_fields=("status", "updated_at"))
    sync_subscription_entitlements(subscription_id=subscription.id)
    return subscription


def test_founder_without_subscription_can_open_paid_content_management() -> None:
    founder = create_user(
        email="founder-no-subscription@example.com",
        username="founder_no_subscription",
        is_superuser=True,
        is_staff=True,
    )

    assert entitlement_decision(user=founder, entitlement_code="content.premium").allowed is True
    client = _client_for(founder)
    response = client.get("/api/v1/management/content")
    snapshot = client.get("/api/v1/subscriptions/current")

    assert response.status_code == 200
    assert snapshot.json()["subscription"]["status"] == "founder"
    assert snapshot.json()["subscription"]["access_exempt"] is True


def test_founder_with_expired_subscription_remains_subscription_exempt() -> None:
    founder = create_user(
        email="founder-expired@example.com",
        username="founder_expired",
        is_superuser=True,
        is_staff=True,
    )
    _expire_subscription(founder)

    decision = entitlement_decision(user=founder, entitlement_code="focus.workspace")
    response = _client_for(founder).get("/api/v1/subscriptions/current")

    assert decision.allowed is True
    assert decision.reason == "founder_access"
    assert response.status_code == 200
    assert response.json()["subscription"]["status"] == Subscription.Status.EXPIRED
    assert response.json()["subscription"]["access_allowed"] is True
    assert response.json()["subscription"]["access_exempt"] is True
    assert response.json()["subscription"]["early_renewal_available"] is False


def test_student_without_entitlement_remains_denied() -> None:
    student = create_user(
        email="student-no-entitlement@example.com", username="student_no_entitlement"
    )

    assert entitlement_decision(user=student, entitlement_code="content.premium").allowed is False
    assert _client_for(student).get("/api/v1/learning-objects").status_code == 403


def test_expired_student_still_requires_renewal() -> None:
    student = create_user(email="student-expired@example.com", username="student_expired")
    _expire_subscription(student)

    decision = entitlement_decision(user=student, entitlement_code="focus.workspace")
    response = _client_for(student).get("/api/v1/subscriptions/current")

    assert decision.allowed is False
    assert decision.reason == "entitlement_required"
    assert response.status_code == 200
    assert response.json()["subscription"]["status"] == Subscription.Status.EXPIRED
    assert response.json()["subscription"]["access_allowed"] is False
    assert response.json()["subscription"]["access_exempt"] is False


def test_staff_user_without_administrator_role_has_no_bypass() -> None:
    staff_user = create_user(
        email="staff-no-founder@example.com",
        username="staff_no_founder",
        is_staff=True,
    )

    decision = entitlement_decision(user=staff_user, entitlement_code="content.premium")

    assert decision.allowed is False
    assert decision.reason == "entitlement_required"

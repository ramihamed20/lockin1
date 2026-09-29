from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import jwt
import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.entitlements.offline_lease import issue_offline_lease, verify_offline_lease
from apps.entitlements.services import EntitlementDecision

pytestmark = pytest.mark.django_db


@override_settings(OFFLINE_LEASE_ED25519_PRIVATE_KEY="")
def test_lease_stops_at_subscription_expiry_and_rejects_tampering() -> None:
    user = SimpleNamespace(pk="student-1")
    now = timezone.now().replace(microsecond=0)
    end = now + timedelta(hours=7)
    decision = EntitlementDecision(
        code="content.premium", allowed=True, reason="granted", expires_at=end
    )
    with patch(
        "apps.entitlements.offline_lease.subscription_access_decision", return_value=decision
    ):
        lease = issue_offline_lease(user=user, now=now)
    claims = verify_offline_lease(lease["token"], user=user)
    assert claims["offline_until"] == int(end.timestamp())
    assert claims["subscription_until"] == int(end.timestamp())
    parts = lease["token"].split(".")
    parts[1] = ("a" if parts[1][0] != "a" else "b") + parts[1][1:]
    with pytest.raises(jwt.InvalidTokenError):
        verify_offline_lease(".".join(parts), user=user)


def test_lease_denies_expired_entitlement() -> None:
    user = SimpleNamespace(pk="student-2")
    decision = EntitlementDecision(
        code="content.premium", allowed=False, reason="entitlement_required"
    )
    with (
        patch(
            "apps.entitlements.offline_lease.subscription_access_decision", return_value=decision
        ),
        pytest.raises(PermissionDenied),
    ):
        issue_offline_lease(user=user)


def test_trial_lease_never_extends_past_trial_and_expired_lease_can_prove_saved_work() -> None:
    user = SimpleNamespace(pk="trial-student")
    verified_at = timezone.now().replace(microsecond=0) - timedelta(hours=25)
    trial_end = verified_at + timedelta(hours=3)
    decision = EntitlementDecision(
        code="content.premium", allowed=True, reason="trial", expires_at=trial_end
    )
    with patch(
        "apps.entitlements.offline_lease.subscription_access_decision", return_value=decision
    ):
        lease = issue_offline_lease(user=user, now=verified_at)
    with pytest.raises(jwt.ExpiredSignatureError):
        verify_offline_lease(lease["token"], user=user)
    claims = verify_offline_lease(lease["token"], user=user, allow_expired=True)
    assert claims["offline_until"] == int(trial_end.timestamp())


def test_lease_endpoint_requires_active_subscription() -> None:
    user = create_user(email="offline-lease@example.com", verified=False)
    client = APIClient()
    client.force_authenticate(user)
    assert client.get("/api/v1/offline/lease/").status_code == 403


def test_unverified_account_with_a_live_grant_can_use_a_bounded_lease() -> None:
    user = create_user(email="pending-verification-with-access@example.com", verified=False)
    end = timezone.now() + timedelta(hours=2)
    grant = EntitlementGrant.objects.create(
        user=user,
        entitlement=EntitlementDefinition.objects.get(code="content.premium"),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
        ends_at=end,
    )
    client = APIClient()
    client.force_authenticate(user)
    response = client.get("/api/v1/offline/lease/")
    assert response.status_code == 200, response.json()
    claims = verify_offline_lease(response.json()["lease"]["token"], user=user)
    assert claims["exp"] <= int(end.timestamp())
    grant.status = EntitlementGrant.Status.REVOKED
    grant.save(update_fields=("status",))
    assert client.get("/api/v1/offline/lease/").status_code == 403
    # An already-issued offline lease remains usable only until its signed
    # expiry; revocation cannot be known to a disconnected device earlier.
    assert claims["exp"] - claims["iat"] <= 86_400


def test_verified_trial_receives_a_lease_capped_by_its_trial_end() -> None:
    user = create_user(email="trial-offline@example.com", with_trial=True)
    client = APIClient()
    client.force_authenticate(user)
    response = client.get("/api/v1/offline/lease/")
    assert response.status_code == 200, response.json()
    claims = verify_offline_lease(response.json()["lease"]["token"], user=user)
    assert claims["exp"] <= int(
        user.subscription_accounts.get().subscriptions.get().trial_ends_at.timestamp()
    )

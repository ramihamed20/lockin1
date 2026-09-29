import base64
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.entitlements.offline_lease import (
    issue_offline_lease,
    public_key_base64,
    verify_offline_lease,
)
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


# A seed whose Base64 uses the characters the two alphabets disagree on
# (standard "+/", URL-safe "-_"), so each format is exercised for real.
SEED = bytes([0xFB, 0xFF, 0xBF]) * 10 + b"\x01\x02"
STANDARD_PADDED = base64.b64encode(SEED).decode()
URL_SAFE_UNPADDED = base64.urlsafe_b64encode(SEED).decode().rstrip("=")


def _public_key(encoded: str) -> str:
    with override_settings(OFFLINE_LEASE_ED25519_PRIVATE_KEY=encoded):
        return public_key_base64()


def test_seed_formats_both_decode_to_the_same_key() -> None:
    assert "+" in STANDARD_PADDED and "/" in STANDARD_PADDED and STANDARD_PADDED.endswith("=")
    assert "-" in URL_SAFE_UNPADDED and "_" in URL_SAFE_UNPADDED and len(URL_SAFE_UNPADDED) == 43
    expected = base64.b64encode(
        Ed25519PrivateKey.from_private_bytes(SEED)
        .public_key()
        .public_bytes(encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
    ).decode()
    assert _public_key(STANDARD_PADDED) == expected
    assert _public_key(URL_SAFE_UNPADDED) == expected
    # Secrets read from files and environments often carry a trailing newline.
    assert _public_key(f"  {URL_SAFE_UNPADDED}\n") == expected
    # URL-safe with its padding, and standard without it, are the same seed.
    assert _public_key(base64.urlsafe_b64encode(SEED).decode()) == expected
    assert _public_key(STANDARD_PADDED.rstrip("=")) == expected


def test_url_safe_unpadded_seed_issues_leases_through_the_endpoint() -> None:
    user = create_user(email="urlsafe-lease@example.com", with_trial=True)
    with override_settings(OFFLINE_LEASE_ED25519_PRIVATE_KEY=URL_SAFE_UNPADDED):
        lease = issue_offline_lease(user=user)
        assert verify_offline_lease(lease["token"], user=user)["sub"] == str(user.pk)
        client = APIClient()
        client.force_authenticate(user)
        response = client.get("/api/v1/offline/lease/")
        assert response.status_code == 200, response.json()
        body = response.json()["lease"]
        assert verify_offline_lease(body["token"], user=user)["sub"] == str(user.pk)
        assert body["public_key"] == _public_key(STANDARD_PADDED)


@pytest.mark.parametrize(
    ("encoded", "reason"),
    [
        ("not base64!", "not Base64 text"),
        (STANDARD_PADDED[:10] + "-" + STANDARD_PADDED[11:], "mixes"),
        (STANDARD_PADDED + "=", "padding"),
        (URL_SAFE_UNPADDED[:20] + "=" + URL_SAFE_UNPADDED[21:], "not Base64 text"),
        (URL_SAFE_UNPADDED[:-2], "not valid Base64"),
    ],
)
def test_malformed_seed_fails_closed_without_revealing_it(encoded: str, reason: str) -> None:
    user = create_user(email=f"bad-seed-{uuid4().hex[:8]}@example.com", with_trial=True)
    with (
        override_settings(OFFLINE_LEASE_ED25519_PRIVATE_KEY=encoded),
        pytest.raises(RuntimeError) as raised,
    ):
        issue_offline_lease(user=user)
    message = str(raised.value)
    assert reason in message
    assert encoded not in message
    assert raised.value.__cause__ is None and raised.value.__suppress_context__


@pytest.mark.parametrize("length", [16, 31, 33, 64])
def test_seed_of_the_wrong_length_is_refused(length: int) -> None:
    for encoded in (
        base64.b64encode(bytes(range(length))).decode(),
        base64.urlsafe_b64encode(bytes(range(length))).decode().rstrip("="),
    ):
        with (
            override_settings(OFFLINE_LEASE_ED25519_PRIVATE_KEY=encoded),
            pytest.raises(RuntimeError, match=f"32 bytes, not {length}") as raised,
        ):
            public_key_base64()
        assert encoded not in str(raised.value)

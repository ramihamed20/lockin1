"""Short-lived, browser-verifiable offline access leases.

The private Ed25519 seed is supplied by the deployment. A deterministic seed
derived from the development Django key is allowed only outside production.
"""

import base64
import hashlib
import logging
import uuid
from datetime import datetime, timedelta

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.accounts.models import User

from .access_permissions import subscription_access_decision

logger = logging.getLogger("lockin.offline")
LEASE_SECONDS = 24 * 60 * 60


def _private_key() -> Ed25519PrivateKey:
    encoded = getattr(settings, "OFFLINE_LEASE_ED25519_PRIVATE_KEY", "")
    if encoded:
        try:
            raw = base64.b64decode(encoded, validate=True)
            if len(raw) != 32:
                raise ValueError("Ed25519 seed must be 32 bytes")
            return Ed25519PrivateKey.from_private_bytes(raw)
        except (ValueError, TypeError) as error:
            raise RuntimeError("Invalid OFFLINE_LEASE_ED25519_PRIVATE_KEY") from error
    if getattr(settings, "ENVIRONMENT", "") == "production":
        raise RuntimeError("OFFLINE_LEASE_ED25519_PRIVATE_KEY is required in production")
    seed = hashlib.sha256((settings.SECRET_KEY + ":offline-lease:dev").encode()).digest()
    return Ed25519PrivateKey.from_private_bytes(seed)


def public_key_base64() -> str:
    raw = (
        _private_key()
        .public_key()
        .public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    )
    return base64.b64encode(raw).decode("ascii")


def issue_offline_lease(*, user: User, now: datetime | None = None) -> dict[str, str]:
    verified_at = now or timezone.now()
    decision = subscription_access_decision(user=user, entitlement_code="content.premium")
    if not decision.allowed:
        raise PermissionDenied("An active Lock-in subscription is required for offline access.")
    # An unbounded manual grant or Founder exemption still gets only 24 hours.
    entitlement_end = decision.expires_at
    if entitlement_end is not None and entitlement_end <= verified_at:
        raise PermissionDenied("The subscription has expired.")
    offline_until = min(
        verified_at + timedelta(seconds=LEASE_SECONDS),
        entitlement_end or verified_at + timedelta(seconds=LEASE_SECONDS),
    )
    claims = {
        "v": 1,
        "sub": str(user.pk),
        "user_id": str(user.pk),
        "iat": int(verified_at.timestamp()),
        "exp": int(offline_until.timestamp()),
        "offline_until": int(offline_until.timestamp()),
        "subscription_until": int(entitlement_end.timestamp()) if entitlement_end else None,
        "jti": str(uuid.uuid4()),
    }
    token = jwt.encode(
        claims, _private_key(), algorithm="EdDSA", headers={"typ": "offline-lease+jwt"}
    )
    logger.info(
        "Offline lease issued",
        extra={"user_id": str(user.pk), "expires_at": offline_until.isoformat()},
    )
    return {
        "token": token,
        "public_key": public_key_base64(),
        "issued_at": verified_at.isoformat(),
        "offline_until": offline_until.isoformat(),
    }


def verify_offline_lease(
    token: str, *, user: User | None = None, allow_expired: bool = False
) -> dict[str, object]:
    try:
        claims = jwt.decode(
            token,
            _private_key().public_key(),
            algorithms=["EdDSA"],
            options={"require": ["sub", "iat", "exp", "jti"], "verify_exp": not allow_expired},
        )
        if (
            claims.get("v") != 1
            or claims.get("exp") != claims.get("offline_until")
            or not isinstance(claims.get("iat"), int)
            or not isinstance(claims.get("exp"), int)
            or claims["exp"] - claims["iat"] > LEASE_SECONDS
            or (
                claims.get("subscription_until") is not None
                and claims["exp"] > claims["subscription_until"]
            )
            or (
                user is not None
                and (claims.get("sub") != str(user.pk) or claims.get("user_id") != str(user.pk))
            )
        ):
            raise jwt.InvalidTokenError("Lease scope mismatch")
        return claims
    except jwt.InvalidTokenError:
        logger.warning(
            "Offline lease verification failed", extra={"user_id": str(user.pk) if user else None}
        )
        raise

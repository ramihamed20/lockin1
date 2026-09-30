"""Short-lived, browser-verifiable offline access leases.

The private Ed25519 seed is supplied by the deployment. A deterministic seed
derived from the development Django key is allowed only outside production.
"""

import base64
import binascii
import hashlib
import logging
import re
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


_BASE64_TEXT = re.compile(r"[A-Za-z0-9+/_-]+={0,2}")
_SEED_BYTES = 32


def _decode_seed(encoded: str) -> bytes:
    """Decode the deployment's Ed25519 seed.

    Accepts the standard padded Base64 an operator gets from `base64`, and the
    URL-safe unpadded form key generators commonly print (43 characters for
    32 bytes). Anything else -- mixed alphabets, misplaced or wrong padding,
    stray characters, a length other than 32 bytes -- is refused. Error
    messages describe the problem, never the value.
    """

    text = encoded.strip()
    if not _BASE64_TEXT.fullmatch(text):
        raise ValueError("the seed is not Base64 text")
    url_safe = "-" in text or "_" in text
    if url_safe and ("+" in text or "/" in text):
        raise ValueError("the seed mixes the standard and URL-safe Base64 alphabets")
    body = text.rstrip("=")
    padding = "=" * (-len(body) % 4)
    if text != body and text != body + padding:
        raise ValueError("the seed's Base64 padding is incorrect")
    try:
        raw = base64.b64decode(body + padding, altchars=b"-_" if url_safe else None, validate=True)
    except binascii.Error:
        raise ValueError("the seed is not valid Base64") from None
    if len(raw) != _SEED_BYTES:
        raise ValueError(f"the seed must decode to {_SEED_BYTES} bytes, not {len(raw)}")
    return raw


def _private_key() -> Ed25519PrivateKey:
    encoded = getattr(settings, "OFFLINE_LEASE_ED25519_PRIVATE_KEY", "")
    if encoded:
        try:
            return Ed25519PrivateKey.from_private_bytes(_decode_seed(encoded))
        except (ValueError, TypeError) as error:
            # The reason names the problem only; the key never reaches a log.
            raise RuntimeError(f"Invalid OFFLINE_LEASE_ED25519_PRIVATE_KEY: {error}") from None
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
        raise PermissionDenied("Current Lock-in study access is required for offline access.")
    # An unbounded manual grant or Founder exemption still gets only 24 hours.
    entitlement_end = decision.expires_at
    if entitlement_end is not None and entitlement_end <= verified_at:
        raise PermissionDenied("Lock-in study access has expired.")
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

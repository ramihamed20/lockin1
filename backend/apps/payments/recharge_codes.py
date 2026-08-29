import base64
import hashlib
import hmac
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


class RechargeCodeError(ValueError):
    pass


def normalize_recharge_code(value: str) -> str:
    normalized = "".join(character for character in value.strip() if character not in " -\t\r\n")
    if not normalized.isascii() or not normalized.isdigit() or not 8 <= len(normalized) <= 32:
        raise RechargeCodeError("Enter the 8–32 digit code printed on the Libyana recharge card.")
    return normalized


def _encryption_key() -> bytes:
    configured = str(getattr(settings, "PAYMENT_CODE_ENCRYPTION_KEY", "")).strip()
    if not configured and getattr(settings, "ENVIRONMENT", "") == "production":
        raise ImproperlyConfigured("PAYMENT_CODE_ENCRYPTION_KEY is required in production.")
    material = configured or str(settings.SECRET_KEY)
    return hashlib.sha256(f"lockin:libyana:v1:{material}".encode()).digest()


def recharge_code_digest(code: str) -> str:
    normalized = normalize_recharge_code(code)
    return hmac.new(_encryption_key(), normalized.encode(), hashlib.sha256).hexdigest()


def encrypt_recharge_code(code: str) -> str:
    normalized = normalize_recharge_code(code)
    nonce = secrets.token_bytes(12)
    encrypted = AESGCM(_encryption_key()).encrypt(
        nonce,
        normalized.encode(),
        b"lockin.manual-payment.v1",
    )
    return "v1." + base64.urlsafe_b64encode(nonce + encrypted).decode()


def decrypt_recharge_code(ciphertext: str) -> str:
    try:
        version, encoded = ciphertext.split(".", 1)
        payload = base64.urlsafe_b64decode(encoded.encode())
        if version != "v1" or len(payload) < 29:
            raise ValueError
        value = AESGCM(_encryption_key()).decrypt(
            payload[:12], payload[12:], b"lockin.manual-payment.v1"
        )
        return normalize_recharge_code(value.decode())
    except (ValueError, UnicodeDecodeError) as error:
        raise RechargeCodeError("The encrypted recharge code could not be read safely.") from error

"""Create a fresh staging identity on the deployment host, never copy production env."""
import argparse
import base64
import os
from pathlib import Path
import re
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def public_key(seed):
    # RFC 8410 PKCS#8 Ed25519 seed; openssl is installed on the Ubuntu host.
    encoded = bytes.fromhex("302e020100300506032b657004220420") + seed
    result = subprocess.run(
        ["openssl", "pkey", "-inform", "DER", "-pubout", "-outform", "DER"],
        input=encoded, capture_output=True, check=True,
    ).stdout
    if not result.startswith(bytes.fromhex("302a300506032b6570032100")) or len(result) != 44:
        raise ValueError("Unexpected Ed25519 public key encoding")
    return base64.b64encode(result[-32:]).decode()


def prepare(root, commit):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Use the full 40-character commit SHA printed by the staging build")
    runtime = root / ".runtime/staging"
    env_file = root / ".env.staging"
    if env_file.exists() or runtime.exists():
        raise ValueError("Staging identity already exists; refusing to overwrite passwords or signing keys")
    runtime.mkdir(mode=0o700, parents=True)
    os.chmod(runtime.parent, 0o700)
    os.chmod(runtime, 0o700)

    def write_secret(name, value):
        path = runtime / name
        path.write_text(value + ("\n" if value else ""))
        # The host directory is root-only. Bind-mounted Compose secrets must be
        # readable by both the Postgres uid and the application's different uid.
        os.chmod(path, 0o444)
        return str(path)

    seed = secrets.token_bytes(32)
    offline_public = public_key(seed)
    basic_password = secrets.token_urlsafe(24)
    password_hash = subprocess.run(
        ["openssl", "passwd", "-6", "-stdin"], input=basic_password.encode(),
        capture_output=True, check=True,
    ).stdout.decode().strip()
    write_secret("htpasswd", "preview:" + password_hash)
    write_secret("tunnel_token", "")
    # All defaults are staging-owned; no production env or credentials are read.
    env = {
        "COMPOSE_PROFILES": "bundled-db",
        "LOCKIN_IMAGE_REPOSITORY": "ghcr.io/ramihamed20/lockin",
        "LOCKIN_IMAGE_TAG": "staging-" + commit,
        "LOCKIN_PUBLIC_HOST": "staging.lockin.ly",
        "LOCKIN_PULL_POLICY": "always",
        "POSTGRES_DB": "lockin_staging", "POSTGRES_HOST": "db",
        "POSTGRES_OWNER_USER": "staging_owner", "POSTGRES_RUNTIME_ROLE": "staging_app",
        "POSTGRES_OWNER_PASSWORD_FILE": write_secret("db_owner", secrets.token_hex(32)),
        "POSTGRES_RUNTIME_PASSWORD_FILE": write_secret("db_runtime", secrets.token_hex(32)),
        "DJANGO_SECRET_KEY_FILE": write_secret("django", secrets.token_urlsafe(64)),
        "OFFLINE_LEASE_ED25519_PRIVATE_KEY_FILE": write_secret("offline", base64.b64encode(seed).decode()),
        "LOCKIN_OFFLINE_LEASE_PUBLIC_KEY": offline_public,
        "PAYMENT_CODE_ENCRYPTION_KEY_FILE": write_secret("payment", secrets.token_hex(32)),
        "OBSERVABILITY_ERROR_WEBHOOK_TOKEN_FILE": write_secret("errors", secrets.token_urlsafe(32)),
        "EMAIL_HOST_PASSWORD_FILE": write_secret("smtp", secrets.token_urlsafe(32)),
        "DJANGO_EMAIL_BACKEND": "django.core.mail.backends.smtp.EmailBackend",
        "DEFAULT_FROM_EMAIL": "Lock-in Staging <preview@staging.lockin.ly>",
        "EMAIL_HOST": "mailpit", "EMAIL_HOST_USER": "staging", "EMAIL_PORT": "1025",
        "EMAIL_USE_TLS": "false", "EMAIL_USE_SSL": "false",
        "DJANGO_TRUSTED_PROXY_CIDRS": "172.30.88.0/24",
        "ACCOUNT_POLICY_VERSION": "2026.10",
        "GUNICORN_WORKERS": "1", "GUNICORN_THREADS": "4",
        "STORAGE_BACKEND": "filesystem", "STORAGE_ALLOW_LOCAL_MEDIA": "true",
        "CONTENT_REQUIRE_CLEAN_SCAN": "false",
        "STUDY_PLAN_V2_ENABLED": "true", "WEB_PUSH_ENABLED": "false",
        "LOCKIN_SUPPORT_EMAIL": "preview@staging.lockin.ly",
        "LOCKIN_LEGAL_ENTITY": "Lock-in Staging", "LOCKIN_LEGAL_JURISDICTION": "Libya",
        "OBSERVABILITY_STATSD_HOST": "127.0.0.1",
        "OBSERVABILITY_ERROR_WEBHOOK_URL": "https://staging.lockin.ly/__staging_errors/",
        "TLS_CERT_PATH": "/dev/null", "TLS_KEY_PATH": "/dev/null",
    }
    env_file.write_text("\n".join(f"{key}={value}" for key, value in env.items()) + "\n")
    os.chmod(env_file, 0o600)
    access = runtime / "access.txt"
    access.write_text("Staging outer gate\nUsername: preview\nPassword: " + basic_password + "\n")
    os.chmod(access, 0o600)
    return offline_public


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit("Run with sudo: staging identity files must be private to the host operator")
    try:
        key = prepare(ROOT, args.commit)
    except (ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
    print("Prepared .env.staging and private .runtime/staging files.")
    print("Set the GitHub Actions repository VARIABLE LOCKIN_STAGING_OFFLINE_LEASE_PUBLIC_KEY to:")
    print(key)  # A public verification key, never the private signing seed.
    print("Outer-gate credentials are only in .runtime/staging/access.txt")

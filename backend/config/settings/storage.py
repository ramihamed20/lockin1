"""Provider-neutral object storage configuration.

Private study material must not live on the application filesystem: container
hosts give ephemeral disks, and a VPS volume cannot be shared by more than one
application container. Any S3-compatible provider (Cloudflare R2, MinIO, AWS
S3, Backblaze B2) is selected purely through ``STORAGE_*`` environment values,
so changing provider is a configuration change.

Managed files stay private in the bucket. Delivery is proxied through the API
so entitlement and malware-scan checks stay server-side; no bucket object is
ever made publicly readable on the strength of this configuration.
"""

from typing import Any
from urllib.parse import urlparse

from django.core.exceptions import ImproperlyConfigured

from .env import env, env_bool, env_int, secret_env

FILESYSTEM_BACKEND = "django.core.files.storage.FileSystemStorage"
S3_BACKEND = "storages.backends.s3.S3Storage"
SUPPORTED_BACKENDS = frozenset({"filesystem", "s3"})
ADDRESSING_STYLES = frozenset({"virtual", "path", "auto"})


def storage_backend_name() -> str:
    backend = env("STORAGE_BACKEND", "filesystem").lower()
    if backend not in SUPPORTED_BACKENDS:
        raise ImproperlyConfigured("STORAGE_BACKEND must be filesystem or s3.")
    return backend


def _require_https_endpoint(endpoint: str) -> None:
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ImproperlyConfigured("STORAGE_ENDPOINT_URL must be an absolute http(s) URL.")
    if parsed.scheme == "http" and not env_bool("STORAGE_ALLOW_INSECURE_ENDPOINT", False):
        raise ImproperlyConfigured(
            "A plaintext STORAGE_ENDPOINT_URL requires STORAGE_ALLOW_INSECURE_ENDPOINT=true, "
            "which is only appropriate for a private in-cluster endpoint such as MinIO."
        )


def s3_storage_options() -> dict[str, Any]:
    """Build the S3 options block from environment values alone."""

    bucket = env("STORAGE_BUCKET_NAME")
    if not bucket:
        raise ImproperlyConfigured("STORAGE_BUCKET_NAME is required when STORAGE_BACKEND=s3.")
    access_key = env("STORAGE_ACCESS_KEY_ID")
    secret_key = secret_env("STORAGE_SECRET_ACCESS_KEY")
    if bool(access_key) != bool(secret_key):
        raise ImproperlyConfigured(
            "Set both STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY, or neither to use "
            "an instance role."
        )
    endpoint = env("STORAGE_ENDPOINT_URL")
    if endpoint:
        _require_https_endpoint(endpoint)
    addressing_style = env("STORAGE_ADDRESSING_STYLE", "virtual").lower()
    if addressing_style not in ADDRESSING_STYLES:
        raise ImproperlyConfigured("STORAGE_ADDRESSING_STYLE must be virtual, path, or auto.")

    options: dict[str, Any] = {
        "bucket_name": bucket,
        # R2 and several other providers reject ACL headers outright, and the
        # bucket policy is the authoritative control on every provider.
        "default_acl": None,
        "querystring_auth": env_bool("STORAGE_QUERYSTRING_AUTH", True),
        "querystring_expire": env_int("STORAGE_URL_EXPIRE_SECONDS", 300),
        "file_overwrite": False,
        "signature_version": env("STORAGE_SIGNATURE_VERSION", "s3v4"),
        "addressing_style": addressing_style,
        "region_name": env("STORAGE_REGION", "auto"),
        "location": env("STORAGE_LOCATION_PREFIX"),
        "object_parameters": {"CacheControl": "private, max-age=0, no-store"},
    }
    if endpoint:
        options["endpoint_url"] = endpoint
    if access_key:
        options["access_key"] = access_key
        options["secret_key"] = secret_key
    public_base_url = env("STORAGE_PUBLIC_BASE_URL")
    if public_base_url:
        # Only meaningful when the operator deliberately fronts the bucket with
        # a CDN. Private managed files are still delivered through the API.
        parsed_public = urlparse(public_base_url)
        if parsed_public.scheme != "https" or not parsed_public.hostname:
            raise ImproperlyConfigured("STORAGE_PUBLIC_BASE_URL must be an HTTPS URL.")
        options["custom_domain"] = parsed_public.netloc + parsed_public.path.rstrip("/")
    return options


def storages_setting(*, static_backend: str) -> dict[str, dict[str, Any]]:
    """Return the ``STORAGES`` mapping for the configured provider."""

    default: dict[str, Any]
    if storage_backend_name() == "s3":
        default = {"BACKEND": S3_BACKEND, "OPTIONS": s3_storage_options()}
    else:
        default = {"BACKEND": FILESYSTEM_BACKEND}
    return {"default": default, "staticfiles": {"BACKEND": static_backend}}

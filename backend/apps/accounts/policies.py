"""The approved document identifier, separate from deployment configuration."""

from datetime import datetime

from django.conf import settings

USER_POLICY_VERSION = "2026.10"


def current_policy_version() -> str:
    return str(settings.ACCOUNT_POLICY_VERSION)


def policy_effective_at() -> datetime | None:
    from django.utils.dateparse import parse_datetime

    value = str(getattr(settings, "USER_POLICY_EFFECTIVE_AT", ""))
    try:
        parsed = parse_datetime(value) if value else None
    except ValueError:
        return None
    return parsed if parsed is not None and parsed.tzinfo is not None else None

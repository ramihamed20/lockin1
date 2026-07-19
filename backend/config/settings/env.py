import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def require_env(name: str) -> str:
    value = env(name)
    if not value:
        raise ImproperlyConfigured(f"Required environment variable {name} is not set.")
    return value


def secret_env(name: str, default: str = "") -> str:
    """Read a secret from NAME or NAME_FILE without allowing ambiguous configuration."""

    direct = os.environ.get(name)
    file_name = env(f"{name}_FILE")
    if direct is not None and file_name:
        raise ImproperlyConfigured(f"Set only one of {name} or {name}_FILE.")
    if file_name:
        try:
            value = Path(file_name).read_text(encoding="utf-8").strip()
        except OSError as error:
            raise ImproperlyConfigured(
                f"Could not read the secret referenced by {name}_FILE."
            ) from error
        if not value or "\x00" in value or len(value) > 65_536:
            raise ImproperlyConfigured(f"The secret referenced by {name}_FILE is invalid.")
        return value
    return (direct if direct is not None else default).strip()


def require_secret_env(name: str) -> str:
    value = secret_env(name)
    if not value:
        raise ImproperlyConfigured(f"Required secret {name} or {name}_FILE is not set.")
    return value


def env_bool(name: str, default: bool = False) -> bool:
    raw = env(name, str(default)).lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise ImproperlyConfigured(f"{name} must be a boolean value.")


def env_int(name: str, default: int) -> int:
    try:
        return int(env(name, str(default)))
    except ValueError as error:
        raise ImproperlyConfigured(f"{name} must be an integer.") from error


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in env(name, default).split(",") if item.strip()]

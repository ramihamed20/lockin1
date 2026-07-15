import os

from django.core.exceptions import ImproperlyConfigured


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def require_env(name: str) -> str:
    value = env(name)
    if not value:
        raise ImproperlyConfigured(f"Required environment variable {name} is not set.")
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

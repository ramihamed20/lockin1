import multiprocessing
import os


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer.") from error
    if value <= 0:
        raise RuntimeError(f"{name} must be positive.")
    return value


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, str(default)).strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be a boolean value.")


bind = "0.0.0.0:8000"
workers = _positive_int("GUNICORN_WORKERS", min(4, multiprocessing.cpu_count() * 2 + 1))
threads = _positive_int("GUNICORN_THREADS", 2)
worker_class = "gthread"
timeout = _positive_int("GUNICORN_TIMEOUT_SECONDS", 60)
graceful_timeout = _positive_int("GUNICORN_GRACEFUL_TIMEOUT_SECONDS", 30)
keepalive = _positive_int("GUNICORN_KEEPALIVE_SECONDS", 5)
max_requests = _positive_int("GUNICORN_MAX_REQUESTS", 1_000)
max_requests_jitter = _positive_int("GUNICORN_MAX_REQUESTS_JITTER", 100)
# Import the application once in the master and fork workers from it. This is
# safe here because nothing is opened before the fork: Django's setup only
# imports, database connections are created lazily per request, the S3 storage
# handle is a lazy object that no start-up path touches, and the StatsD sink
# builds a fresh socket per metric rather than holding one. Recycling through
# max_requests still applies. The trade-off is that a code change needs a
# restart rather than a HUP reload, which is how the containers deploy anyway.
preload_app = _bool("GUNICORN_PRELOAD_APP", True)
accesslog = "-"
errorlog = "-"
capture_output = True
forwarded_allow_ips = os.environ.get("GUNICORN_FORWARDED_ALLOW_IPS", "127.0.0.1")

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


bind = "0.0.0.0:8000"
workers = _positive_int("GUNICORN_WORKERS", min(4, multiprocessing.cpu_count() * 2 + 1))
threads = _positive_int("GUNICORN_THREADS", 2)
worker_class = "gthread"
timeout = _positive_int("GUNICORN_TIMEOUT_SECONDS", 60)
graceful_timeout = _positive_int("GUNICORN_GRACEFUL_TIMEOUT_SECONDS", 30)
keepalive = _positive_int("GUNICORN_KEEPALIVE_SECONDS", 5)
max_requests = _positive_int("GUNICORN_MAX_REQUESTS", 1_000)
max_requests_jitter = _positive_int("GUNICORN_MAX_REQUESTS_JITTER", 100)
accesslog = "-"
errorlog = "-"
capture_output = True
forwarded_allow_ips = os.environ.get("GUNICORN_FORWARDED_ALLOW_IPS", "127.0.0.1")

from collections.abc import Callable
from uuid import UUID, uuid4

from django.http import HttpRequest, HttpResponse

from .context import reset_remote_address, reset_request_id, set_remote_address, set_request_id


def _safe_request_id(raw_value: str | None) -> str:
    if raw_value:
        try:
            return str(UUID(raw_value))
        except ValueError:
            pass
    return str(uuid4())


class RequestIdMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        request_id = _safe_request_id(request.headers.get("X-Request-ID"))
        request.META["LOCKIN_REQUEST_ID"] = request_id
        token = set_request_id(request_id)
        remote_token = set_remote_address(request.META.get("REMOTE_ADDR"))
        try:
            response = self.get_response(request)
            response["X-Request-ID"] = request_id
            return response
        finally:
            reset_remote_address(remote_token)
            reset_request_id(token)

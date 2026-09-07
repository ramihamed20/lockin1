from collections.abc import Callable

from django.http import HttpRequest, HttpResponse

API_PATH_PREFIX = "/api/"


class ApiNoStoreMiddleware:
    """Keep API responses out of every cache, including the back/forward cache.

    These responses carry account and session data, and a copy of one is a copy
    of somebody's private state: a shared proxy must not hold it, the browser
    must not replay it from disk after a sign-out, and a page restored from the
    back/forward cache must not be able to re-read it without asking the server
    again. ``no-store`` is the one directive that says all three.

    Scope is deliberately narrow. Only ``/api/`` is touched, so static assets,
    media and any CDN-cached public document keep the caching they already have
    -- in production those are not served by Django at all. A response that has
    already declared its own ``Cache-Control`` is left alone, so an endpoint can
    still opt out deliberately rather than by accident.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        if not request.path.startswith(API_PATH_PREFIX):
            return response
        if response.has_header("Cache-Control"):
            return response
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
        response.headers["Pragma"] = "no-cache"
        return response

"""Exercise every routed API method guarded by an explicit management permission."""

import re
from uuid import uuid4

import pytest
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user


def privileged_routes(patterns, prefix=""):
    for pattern in patterns:
        route = prefix + str(pattern.pattern)
        if isinstance(pattern, URLResolver):
            if route.startswith("admin/"):
                continue
            yield from privileged_routes(pattern.url_patterns, route)
        elif isinstance(pattern, URLPattern) and route.startswith("api/v1/"):
            view = getattr(pattern.callback, "cls", None)
            if view is None:
                continue
            permission_names = {permission.__name__ for permission in view.permission_classes}
            if not permission_names.intersection(
                {
                    "IsAdministrator",
                    "HasOperationalCapability",
                    "IsCreatorOrAdministrator",
                    "IsModeratorOrAdministrator",
                }
            ):
                continue

            def identifier(match):
                if match.group(0) == "<str:target_type>":
                    return "payments.payment"
                if match.group(0) == "<str:target_id>":
                    return str(uuid4())
                kind = match.group(1)
                return str(uuid4()) if kind == "uuid" else "1" if kind == "int" else "audit"

            path = "/" + re.sub(r"<(?:([a-z]+):)?[a-z_]+>", identifier, route)
            for method in view.http_method_names:
                if method in {"get", "post", "put", "patch", "delete"} and hasattr(view, method):
                    yield path, method


@pytest.mark.django_db
def test_all_explicitly_privileged_api_methods_deny_anonymous_and_ordinary_accounts() -> None:
    routes = list(privileged_routes(get_resolver().url_patterns))
    assert len(routes) >= 80, "The management authorization matrix unexpectedly lost coverage."
    anonymous = APIClient()
    ordinary = APIClient()
    ordinary.force_authenticate(create_user(with_trial=True))
    for path, method in routes:
        for client in (anonymous, ordinary):
            response = getattr(client, method)(path, {}, format="json")
            assert response.status_code == 403, (path, method, response.status_code)
            assert response.json()["error"]["code"] in {"not_authenticated", "permission_denied"}

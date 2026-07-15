from unittest.mock import patch

import pytest
from django.db import DatabaseError
from django.test import Client, RequestFactory
from rest_framework.exceptions import NotFound

from platform_core.api.exceptions import lockin_exception_handler


@pytest.mark.django_db
def test_health_endpoints_are_public_and_ready() -> None:
    client = Client()

    live_response = client.get("/api/v1/health/live")
    ready_response = client.get("/api/v1/health/ready")

    assert live_response.status_code == 200
    assert live_response.json() == {"status": "ok", "service": "lockin-api"}
    assert ready_response.status_code == 200
    assert ready_response.json()["status"] == "ready"
    assert "X-Request-ID" in live_response


def test_readiness_does_not_leak_database_errors() -> None:
    client = Client()
    with patch("platform_core.api.views.connection.cursor", side_effect=DatabaseError("secret")):
        response = client.get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "service": "lockin-api"}
    assert "secret" not in response.content.decode()


def test_exception_handler_returns_stable_envelope() -> None:
    request = RequestFactory().get("/api/v1/missing")
    request.META["LOCKIN_REQUEST_ID"] = "8dd9fb10-0391-4c15-aa5f-0d1b2bdf1d76"

    response = lockin_exception_handler(NotFound("Missing"), {"request": request})

    assert response is not None
    assert response.data == {
        "error": {
            "code": "not_found",
            "message": "Missing",
            "fields": None,
            "request_id": "8dd9fb10-0391-4c15-aa5f-0d1b2bdf1d76",
        }
    }

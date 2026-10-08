import json
from unittest.mock import patch

import pytest

from apps.accounts.serializers import LoginSerializer
from apps.accounts.tests.helpers import csrf_client
from apps.files.views import _byte_range
from platform_core.tests.test_portability import MANAGED_DATABASE_URL, _boot_production


def test_password_input_is_bounded_before_password_hashing() -> None:
    serializer = LoginSerializer(data={"email": "synthetic@example.test", "password": "a" * 1025})
    assert not serializer.is_valid()
    assert "password" in serializer.errors


@pytest.mark.django_db
def test_json_payload_limit_applies_before_authentication(settings) -> None:
    settings.DATA_UPLOAD_MAX_MEMORY_SIZE = 128
    client, csrf = csrf_client()
    with patch("apps.accounts.views.authenticate", return_value=None) as authenticate:
        response = client.post(
            "/api/v1/auth/login",
            json.dumps({"email": "synthetic@example.test", "password": "a" * 256}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
    assert response.status_code == 413
    authenticate.assert_not_called()
    assert response.json()["error"]["code"] == "payload_too_large"


def test_extremely_large_range_numbers_are_invalid_instead_of_internal_errors() -> None:
    assert _byte_range(f"bytes={'9' * 5000}-", 100) is None


def test_production_refuses_wildcard_csrf_origins() -> None:
    result = _boot_production(
        DATABASE_URL=MANAGED_DATABASE_URL,
        DJANGO_CSRF_TRUSTED_ORIGINS="https://*.example.ly",
    )
    assert result.returncode != 0
    assert "explicit HTTPS origins" in result.stderr

from django.test import RequestFactory
from rest_framework.exceptions import ErrorDetail, ValidationError

from platform_core.api.exceptions import lockin_exception_handler


def test_validation_preserves_field_rule_codes_and_request_reference() -> None:
    request = RequestFactory().post("/api/v1/study-plan/profile")
    request.META["LOCKIN_REQUEST_ID"] = "safe-reference"
    response = lockin_exception_handler(
        ValidationError(
            {
                "timezone": [ErrorDetail("Choose a valid timezone.", code="invalid_timezone")],
                "title": [ErrorDetail("Too long.", code="max_length")],
            }
        ),
        {"request": request},
    )
    assert response is not None
    error = response.data["error"]
    assert error["request_id"] == "safe-reference"
    assert error["field_codes"] == {
        "timezone": ["invalid_timezone"],
        "title": ["max_length"],
    }
    assert error["fields"]["timezone"] == ["Choose a valid timezone."]


def test_non_field_rules_keep_the_same_shape_as_non_field_messages() -> None:
    response = lockin_exception_handler(
        ValidationError([ErrorDetail("Choose each day once.", code="duplicate_day")]), {}
    )
    assert response is not None
    assert response.data["error"]["field_codes"] == {"non_field_errors": ["duplicate_day"]}

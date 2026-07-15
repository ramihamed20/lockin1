from typing import Any

from rest_framework.exceptions import APIException
from rest_framework.response import Response
from rest_framework.views import exception_handler


def lockin_exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    response = exception_handler(exc, context)
    if response is None:
        return None

    request = context.get("request")
    request_meta = getattr(request, "META", {})
    request_id = request_meta.get("LOCKIN_REQUEST_ID")
    detail = response.data
    code = "request_failed"
    message = "The request could not be completed."
    fields: Any = None

    if isinstance(exc, APIException):
        code_value = exc.get_codes()
        if isinstance(code_value, str):
            code = code_value

    if isinstance(detail, dict):
        raw_detail = detail.get("detail")
        if raw_detail is not None:
            message = str(raw_detail)
        fields = {key: value for key, value in detail.items() if key != "detail"} or None
    elif isinstance(detail, list):
        fields = {"non_field_errors": detail}
    elif detail:
        message = str(detail)

    response.data = {
        "error": {
            "code": code,
            "message": message,
            "fields": fields,
            "request_id": request_id,
        }
    }
    return response

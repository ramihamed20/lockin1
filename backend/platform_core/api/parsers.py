from io import BytesIO

from django.conf import settings
from rest_framework.exceptions import APIException
from rest_framework.parsers import JSONParser


class PayloadTooLarge(APIException):
    status_code = 413
    default_detail = "The request exceeds the allowed size."
    default_code = "payload_too_large"


class BoundedJSONParser(JSONParser):
    """Apply Django's memory limit to JSON streams as well as form bodies."""

    def parse(self, stream, media_type=None, parser_context=None):  # type: ignore[no-untyped-def]
        limit = int(settings.DATA_UPLOAD_MAX_MEMORY_SIZE or 2_621_440)
        # DRF reads the stream directly, bypassing HttpRequest.body's size check.
        # Reading at most limit+1 also bounds requests without Content-Length.
        payload = stream.read(limit + 1)
        if len(payload) > limit:
            raise PayloadTooLarge()
        return super().parse(BytesIO(payload), media_type=media_type, parser_context=parser_context)

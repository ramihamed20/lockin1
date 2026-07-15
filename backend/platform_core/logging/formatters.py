import json
import logging
from datetime import UTC, datetime
from typing import Any

from .context import request_id_context


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = request_id_context.get()
        if request_id:
            payload["request_id"] = request_id
        event_name = getattr(record, "event_name", None)
        event_id = getattr(record, "event_id", None)
        if event_name:
            payload["event_name"] = event_name
        if event_id:
            payload["event_id"] = event_id
        if record.exc_info:
            exception_type = record.exc_info[0]
            if exception_type is not None:
                payload["exception_type"] = exception_type.__name__
        return json.dumps(payload, ensure_ascii=False, default=str)

import json
from io import BytesIO, StringIO
from typing import Any
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

URLOPEN = "apps.payments.management.commands.telegram_webhook.urlopen"
SECRET = "webhook-secret-never-printed"


class _Response:
    def __init__(self, body: Any) -> None:
        self._raw = body if isinstance(body, bytes) else json.dumps(body).encode()

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def read(self) -> bytes:
        return self._raw


@pytest.fixture(autouse=True)
def _telegram_settings(settings: Any) -> None:
    settings.TELEGRAM_BOT_TOKEN = "bot-token"
    settings.TELEGRAM_WEBHOOK_SECRET_TOKEN = SECRET


def _run(*args: str) -> str:
    stdout = StringIO()
    call_command("telegram_webhook", *args, stdout=stdout)
    return stdout.getvalue()


def _sent(mock: Any) -> tuple[str, dict[str, Any]]:
    request = mock.call_args.args[0]
    return request.full_url, json.loads(request.data)


def test_register_sends_the_secret_and_never_prints_it() -> None:
    with patch(URLOPEN, return_value=_Response({"ok": True, "result": True})) as mock:
        output = _run("--url", "https://app.example.test/", "--drop-pending")

    url, payload = _sent(mock)
    assert url == "https://api.telegram.org/botbot-token/setWebhook"
    assert payload == {
        "url": "https://app.example.test/api/v1/billing/webhooks/telegram",
        "secret_token": SECRET,
        "allowed_updates": ["callback_query"],
        "drop_pending_updates": True,
        "max_connections": 10,
    }
    assert "https://app.example.test/api/v1/billing/webhooks/telegram" in output
    assert SECRET not in output


def test_register_accepts_the_full_webhook_path() -> None:
    with patch(URLOPEN, return_value=_Response({"ok": True})) as mock:
        _run("--url", "https://app.example.test/api/v1/billing/webhooks/telegram")

    assert _sent(mock)[1]["url"] == "https://app.example.test/api/v1/billing/webhooks/telegram"


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("", "Pass --url"),
        ("http://app.example.test", "absolute HTTPS origin"),
        ("https://", "absolute HTTPS origin"),
        ("https://app.example.test/?x=1", "no query, fragment or credentials"),
        ("https://user@app.example.test", "no query, fragment or credentials"),
        ("https://app.example.test/elsewhere", "Pass the origin only"),
    ],
)
def test_register_rejects_unsafe_urls_before_calling_telegram(url: str, message: str) -> None:
    with patch(URLOPEN) as mock, pytest.raises(CommandError, match=message):
        _run("--url", url) if url else _run()
    mock.assert_not_called()


def test_register_refuses_without_a_webhook_secret(settings: Any) -> None:
    settings.TELEGRAM_WEBHOOK_SECRET_TOKEN = ""
    with patch(URLOPEN) as mock, pytest.raises(CommandError, match="SECRET_TOKEN"):
        _run("--url", "https://app.example.test")
    mock.assert_not_called()


def test_show_prints_only_the_public_webhook_fields() -> None:
    info = {
        "url": "https://app.example.test/api/v1/billing/webhooks/telegram",
        "pending_update_count": 2,
        "allowed_updates": ["callback_query"],
        "ip_address": "203.0.113.1",
    }
    with patch(URLOPEN, return_value=_Response({"ok": True, "result": info})):
        shown = json.loads(_run("--show"))

    assert shown["url"] == info["url"]
    assert shown["pending_update_count"] == 2
    assert shown["last_error_message"] is None
    assert "ip_address" not in shown


def test_delete_forwards_the_drop_pending_choice() -> None:
    with patch(URLOPEN, return_value=_Response({"ok": True})) as mock:
        output = _run("--delete")

    url, payload = _sent(mock)
    assert url.endswith("/deleteWebhook")
    assert payload == {"drop_pending_updates": False}
    assert "removed" in output


def test_missing_bot_token_fails_before_any_request(settings: Any) -> None:
    settings.TELEGRAM_BOT_TOKEN = "  "
    with patch(URLOPEN) as mock, pytest.raises(CommandError, match="TELEGRAM_BOT_TOKEN"):
        _run("--show")
    mock.assert_not_called()


@pytest.mark.parametrize(
    ("outcome", "message"),
    [
        (HTTPError("https://api.telegram.org", 401, "Unauthorized", {}, BytesIO()), "HTTP 401"),  # type: ignore[arg-type]
        (URLError("unreachable"), "Could not reach Telegram"),
        (TimeoutError(), "Could not reach Telegram"),
        (_Response(b"not json"), "Could not reach Telegram"),
        (_Response(["not", "an", "object"]), "unexpected payload"),
        (_Response({"ok": False, "description": "Bad Request"}), "failed: Bad Request"),
    ],
)
def test_telegram_failures_become_command_errors(outcome: Any, message: str) -> None:
    kwargs = (
        {"side_effect": outcome} if isinstance(outcome, Exception) else {"return_value": outcome}
    )
    with patch(URLOPEN, **kwargs), pytest.raises(CommandError, match=message):
        _run("--show")

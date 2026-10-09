"""Register, inspect or remove the Telegram webhook for this deployment.

The URL is an argument rather than a constant: this repository is deployed to
more than one host shape, and a domain baked into source is a domain that will
be wrong somewhere. Credentials come from the environment and are never printed,
echoed back, or written to a file.
"""

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError, CommandParser

WEBHOOK_PATH = "/api/v1/billing/webhooks/telegram"
ALLOWED_UPDATES = ["callback_query"]


def _call(method: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    token = str(getattr(settings, "TELEGRAM_BOT_TOKEN", "")).strip()
    if not token:
        raise CommandError("TELEGRAM_BOT_TOKEN is not configured in this environment.")
    request = Request(  # noqa: S310 - the Telegram API origin is fixed here.
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload or {}).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(  # noqa: S310 - fixed Telegram origin with configured credential.
            request,
            timeout=int(getattr(settings, "TELEGRAM_HTTP_TIMEOUT_SECONDS", 5)) * 4,
        ) as response:
            body = json.loads(response.read().decode())
    except HTTPError as error:
        # The body can echo the request; report the status only.
        raise CommandError(f"Telegram rejected {method} with HTTP {error.code}.") from error
    except (URLError, TimeoutError, OSError, ValueError) as error:
        raise CommandError(f"Could not reach Telegram for {method}.") from error
    if not isinstance(body, dict):
        raise CommandError(f"Telegram returned an unexpected payload for {method}.")
    if not body.get("ok"):
        raise CommandError(f"Telegram reported {method} as failed: {body.get('description', '')}")
    return body


class Command(BaseCommand):
    help = "Register, show or delete this deployment's Telegram webhook."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--url",
            help=(
                "Public HTTPS origin of this deployment, for example "
                "https://app.example.com. The webhook path is appended."
            ),
        )
        parser.add_argument("--show", action="store_true", help="Print current webhook status.")
        parser.add_argument("--delete", action="store_true", help="Remove the webhook.")
        parser.add_argument(
            "--drop-pending",
            action="store_true",
            help="Discard updates queued before this registration.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        del args
        if options["show"]:
            info = _call("getWebhookInfo").get("result", {})
            # url is not a secret; the secret token is never returned by Telegram.
            self.stdout.write(
                json.dumps(
                    {
                        "url": info.get("url", ""),
                        "pending_update_count": info.get("pending_update_count", 0),
                        "last_error_date": info.get("last_error_date"),
                        "last_error_message": info.get("last_error_message"),
                        "allowed_updates": info.get("allowed_updates", []),
                        "has_custom_certificate": info.get("has_custom_certificate", False),
                    },
                    indent=2,
                    sort_keys=True,
                )
            )
            return

        if options["delete"]:
            _call("deleteWebhook", {"drop_pending_updates": bool(options["drop_pending"])})
            self.stdout.write(self.style.SUCCESS("Telegram webhook removed."))
            return

        raw_url = str(options["url"] or "").strip()
        if not raw_url:
            raise CommandError("Pass --url with this deployment's public HTTPS origin.")
        parsed = urlparse(raw_url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise CommandError("The webhook URL must be an absolute HTTPS origin.")
        if parsed.query or parsed.fragment or parsed.username:
            raise CommandError("The webhook URL must carry no query, fragment or credentials.")
        base = parsed.path.rstrip("/")
        if base and base != WEBHOOK_PATH:
            raise CommandError(f"Pass the origin only; {WEBHOOK_PATH} is appended automatically.")

        secret = str(getattr(settings, "TELEGRAM_WEBHOOK_SECRET_TOKEN", "")).strip()
        if not secret:
            raise CommandError(
                "TELEGRAM_WEBHOOK_SECRET_TOKEN is not configured. Registering without it "
                "would leave the endpoint open to anyone who guesses the path."
            )

        _call(
            "setWebhook",
            {
                "url": f"https://{parsed.netloc}{WEBHOOK_PATH}",
                "secret_token": secret,
                "allowed_updates": ALLOWED_UPDATES,
                "drop_pending_updates": bool(options["drop_pending"]),
                "max_connections": 10,
            },
        )
        # The URL is public information; the secret is not echoed.
        self.stdout.write(
            self.style.SUCCESS(
                f"Telegram webhook registered at https://{parsed.netloc}{WEBHOOK_PATH} "
                f"for {', '.join(ALLOWED_UPDATES)}."
            )
        )

"""The Telegram webhook. Unauthenticated by session, authenticated by secret.

The URL is public, so the secret header Telegram echoes on every delivery is
what separates a real update from anyone who guessed the path. It is checked
before the body is parsed, and an unset secret closes the endpoint entirely
rather than accepting unauthenticated updates.

Nothing here decides a payment. It validates the envelope and hands the update
to ``telegram_actions``, which calls the same review service the operations
console does.
"""

import hmac
import json
import logging
from typing import Any

from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from platform_core.observability import providers

from .telegram_actions import TelegramAuthorizationError, handle_callback_query, webhook_secret

logger = logging.getLogger("lockin.telegram")

# Telegram updates are small. Anything larger is not one.
MAX_UPDATE_BYTES = 64 * 1024


@method_decorator(csrf_exempt, name="dispatch")
class TelegramWebhookView(APIView):
    """Receive callback updates for the configured bot."""

    # Session authentication is meaningless here: the caller is Telegram, and
    # the secret header is the credential. CSRF likewise does not apply to a
    # server-to-server POST with no cookie.
    authentication_classes: list[type] = []
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        secret = webhook_secret()
        if not secret:
            # Callback handling is off for this deployment. Say nothing useful.
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        presented = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if not hmac.compare_digest(presented, secret):
            providers.metric_sink.increment(
                "telegram.webhook.rejected", attributes={"reason": "secret"}
            )
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if not str(getattr(settings, "TELEGRAM_BOT_TOKEN", "")).strip():
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        body = request.body
        if len(body) > MAX_UPDATE_BYTES:
            return Response({"detail": "Invalid update."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            update = json.loads(body)
        except (TypeError, ValueError):
            return Response({"detail": "Invalid update."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(update, dict):
            return Response({"detail": "Invalid update."}, status=status.HTTP_400_BAD_REQUEST)

        callback_query = update.get("callback_query")
        if not isinstance(callback_query, dict):
            # A message, an edit, anything else this bot does not act on. 200 so
            # Telegram does not retry an update that will never be interesting.
            return Response({"status": "ignored"})

        try:
            outcome = handle_callback_query(callback_query=_sanitised(callback_query))
        except TelegramAuthorizationError as error:
            # Log the reason for operators; tell the caller nothing.
            logger.warning(
                "Rejected an unauthorized Telegram payment action",
                extra={"reason": str(error)},
            )
            providers.metric_sink.increment(
                "telegram.webhook.rejected", attributes={"reason": "unauthorized"}
            )
            return Response({"detail": "Not permitted."}, status=status.HTTP_403_FORBIDDEN)
        except Exception:
            # A failure here must not leave Telegram retrying a payment action
            # whose transaction may already have committed. The database is
            # authoritative and the operator can retry from the console.
            logger.exception("Telegram payment callback failed")
            providers.error_reporter.capture_exception(
                RuntimeError("telegram callback failed"), context={"stage": "telegram-callback"}
            )
            return Response({"status": "error"}, status=status.HTTP_200_OK)

        providers.metric_sink.increment(
            "telegram.webhook.handled", attributes={"changed": str(outcome.changed).lower()}
        )
        return Response({"status": "handled", "changed": outcome.changed})


def _sanitised(callback_query: dict[str, Any]) -> dict[str, Any]:
    """Keep only the fields the handler reads.

    An update is attacker-influenced input. Narrowing it here means a surprising
    extra field cannot reach anything downstream, and keeps the handler's
    contract small enough to read.
    """

    message = callback_query.get("message")
    message = message if isinstance(message, dict) else {}
    chat = message.get("chat")
    chat = chat if isinstance(chat, dict) else {}
    sender = callback_query.get("from")
    sender = sender if isinstance(sender, dict) else {}
    return {
        "id": callback_query.get("id"),
        "data": callback_query.get("data"),
        "from": {"id": sender.get("id")},
        "message": {
            "message_id": message.get("message_id"),
            "text": message.get("text"),
            "chat": {"id": chat.get("id")},
        },
    }

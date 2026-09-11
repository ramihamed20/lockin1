import contextlib
import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import UUID

from django.conf import settings

from apps.system_configuration.services import get_configuration_value


@dataclass(frozen=True, slots=True)
class ManualPaymentTelegramMessage:
    class Event:
        NEW_SUBSCRIPTION = "new_subscription"
        EARLY_RENEWAL = "early_renewal"
        APPROVED = "approved"
        REJECTED = "rejected"

    event: str
    payment_id: str
    user_id: str
    username: str
    plan: str
    amount: str
    payment_method: str
    submitted: str | None = None
    current_expiry: str | None = None
    recharge_codes: tuple[str, ...] = ()

    def _heading(self) -> str:
        return {
            self.Event.NEW_SUBSCRIPTION: "🔔 طلب اشتراك جديد",
            self.Event.EARLY_RENEWAL: "🔔 طلب تجديد مبكر",
            self.Event.APPROVED: "✅ تمت الموافقة على الدفع",
            self.Event.REJECTED: "❌ تم رفض الدفع",
        }[self.event]

    def render(self) -> str:
        event_label = {
            self.Event.NEW_SUBSCRIPTION: "New Subscription",
            self.Event.EARLY_RENEWAL: "Early Renewal",
            self.Event.APPROVED: "Approved",
            self.Event.REJECTED: "Rejected",
        }[self.event]
        return "\n".join(
            (
                self._heading(),
                f"📌 Type: {event_label}",
                f"👤 Username: {self.username}",
                f"🆔 User ID: {self.user_id}",
                f"📦 الخطة: {self.plan}",
                f"💰 السعر: {self.amount}",
                f"💳 طريقة الدفع: {self.payment_method}",
                *((f"📅 Current expiry: {self.current_expiry}",) if self.current_expiry else ()),
                *(
                    f"🎫 Card {position}: {code}"
                    for position, code in enumerate(self.recharge_codes, start=1)
                ),
                *((f"🕐 وقت الإرسال: {self.submitted}",) if self.submitted else ()),
                f"📄 Request: #{self.payment_id}",
                *(
                    ("🟡 الدفع: تحت التدقيق", "🟢 الاشتراك: مفعل")
                    if self.event in (self.Event.NEW_SUBSCRIPTION, self.Event.EARLY_RENEWAL)
                    else ()
                ),
            )
        )


class TelegramCallbackError(ValueError):
    """Callback data that is malformed, unsigned, or signed with the wrong key."""


# Telegram caps callback_data at 64 bytes, so the payload carries an identifier
# and nothing else. No recharge code, username, account id or token ever goes in
# here: callback_data is echoed back by the client and is visible to anyone who
# can read the bot's traffic.
#
#   p1:a:<32 hex payment id>:<10 hex signature>   -> 48 bytes
#
# The signature is not the authorisation -- the webhook independently checks the
# chat, the operator and their capability -- it only proves the button came from
# a message this deployment sent, so a stale button from another environment or
# a tampered payload is refused before any lookup happens.
CALLBACK_VERSION = "p1"
CALLBACK_ACTIONS = {"a": "approve", "r": "reject"}
_ACTION_CODES = {value: key for key, value in CALLBACK_ACTIONS.items()}
_SIGNATURE_LENGTH = 10


def _callback_signing_key() -> bytes:
    token = str(getattr(settings, "TELEGRAM_BOT_TOKEN", "")).strip()
    secret = str(getattr(settings, "TELEGRAM_WEBHOOK_SECRET_TOKEN", "")).strip()
    material = f"{token}|{secret}|{settings.SECRET_KEY}"
    return hashlib.sha256(f"lockin:telegram-callback:v1:{material}".encode()).digest()


def _sign_callback(action: str, payment_id: str) -> str:
    digest = hmac.new(
        _callback_signing_key(), f"{action}:{payment_id}".encode(), hashlib.sha256
    ).hexdigest()
    return digest[:_SIGNATURE_LENGTH]


def build_callback_data(*, action: str, payment_id: UUID | str) -> str:
    code = _ACTION_CODES.get(action)
    if code is None:
        raise TelegramCallbackError("Unsupported Telegram payment action.")
    identifier = UUID(str(payment_id)).hex
    return f"{CALLBACK_VERSION}:{code}:{identifier}:{_sign_callback(action, identifier)}"


def parse_callback_data(raw: str) -> tuple[str, UUID]:
    """Return ``(action, payment_id)`` for well-formed, correctly signed data."""

    if not isinstance(raw, str) or len(raw) > 64:
        raise TelegramCallbackError("Telegram callback data is malformed.")
    parts = raw.split(":")
    if len(parts) != 4:
        raise TelegramCallbackError("Telegram callback data is malformed.")
    version, code, identifier, signature = parts
    if version != CALLBACK_VERSION:
        raise TelegramCallbackError("Telegram callback data is malformed.")
    action = CALLBACK_ACTIONS.get(code)
    if action is None:
        raise TelegramCallbackError("Telegram callback data is malformed.")
    try:
        payment_id = UUID(hex=identifier)
    except (ValueError, AttributeError) as error:
        raise TelegramCallbackError("Telegram callback data is malformed.") from error
    if not hmac.compare_digest(signature, _sign_callback(action, payment_id.hex)):
        raise TelegramCallbackError("Telegram callback data failed verification.")
    return action, payment_id


def payment_action_keyboard(payment_id: UUID | str) -> dict[str, object]:
    return {
        "inline_keyboard": [
            [
                {
                    "text": "☑ Approve",
                    "callback_data": build_callback_data(action="approve", payment_id=payment_id),
                },
                {
                    "text": "❌ Reject",
                    "callback_data": build_callback_data(action="reject", payment_id=payment_id),
                },
            ]
        ]
    }


def _event_enabled(event: str) -> bool:
    if not get_configuration_value("telegram.notifications_enabled"):
        return False
    key = {
        ManualPaymentTelegramMessage.Event.NEW_SUBSCRIPTION: (
            "telegram.new_payment_notifications_enabled"
        ),
        ManualPaymentTelegramMessage.Event.EARLY_RENEWAL: (
            "telegram.new_payment_notifications_enabled"
        ),
        ManualPaymentTelegramMessage.Event.APPROVED: "telegram.approval_notifications_enabled",
        ManualPaymentTelegramMessage.Event.REJECTED: "telegram.rejection_notifications_enabled",
    }[event]
    return bool(get_configuration_value(key))


def configured_chat_id() -> str:
    return str(
        getattr(settings, "TELEGRAM_ADMIN_CHAT_ID", "")
        or getattr(settings, "TELEGRAM_PAYMENT_CHAT_ID", "")
    ).strip()


def authorized_chat_ids() -> frozenset[str]:
    """Chats whose buttons may act on a payment.

    Both configured chats count: a deployment may route notifications to one and
    keep the other for operators. An update from anywhere else is refused before
    the payment is looked up.
    """

    return frozenset(
        value
        for value in (
            str(getattr(settings, "TELEGRAM_ADMIN_CHAT_ID", "")).strip(),
            str(getattr(settings, "TELEGRAM_PAYMENT_CHAT_ID", "")).strip(),
        )
        if value
    )


def _call(method: str, payload: dict[str, Any]) -> bool:
    """Best-effort isolated Telegram call; no credentials means a safe no-op.

    Never raises. The database is authoritative for every payment decision, and
    Telegram is a replaceable channel that must not be able to roll one back or
    turn a completed review into a server error.
    """

    token = str(getattr(settings, "TELEGRAM_BOT_TOKEN", "")).strip()
    if not token:
        return False
    request = Request(  # noqa: S310 - the Telegram API origin is fixed below.
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(  # noqa: S310 - fixed Telegram origin with configured bot credential.
            request,
            timeout=int(getattr(settings, "TELEGRAM_HTTP_TIMEOUT_SECONDS", 5)),
        ) as response:
            return 200 <= int(response.status) < 300
    except (HTTPError, URLError, TimeoutError, OSError):
        return False


def notify_manual_payment(message: ManualPaymentTelegramMessage) -> bool:
    """Send a payment notification, with Approve/Reject buttons while it is pending."""

    if not _event_enabled(message.event):
        return False
    chat_id = configured_chat_id()
    if not chat_id:
        return False
    payload: dict[str, Any] = {"chat_id": chat_id, "text": message.render()}
    if message.event in (
        ManualPaymentTelegramMessage.Event.NEW_SUBSCRIPTION,
        ManualPaymentTelegramMessage.Event.EARLY_RENEWAL,
    ):
        # Only a pending submission gets buttons. An approved or rejected
        # notification is a record of something already decided.
        #
        # A payment id that cannot be signed still deserves its notification, so
        # the keyboard is the part that is dropped, not the message.
        with contextlib.suppress(TelegramCallbackError, ValueError):
            payload["reply_markup"] = payment_action_keyboard(message.payment_id)
    return _call("sendMessage", payload)


def answer_callback_query(*, callback_query_id: str, text: str, alert: bool = False) -> bool:
    """Clear the client's loading spinner and say what happened."""

    return _call(
        "answerCallbackQuery",
        {
            "callback_query_id": callback_query_id,
            # Telegram truncates beyond 200 characters.
            "text": text[:200],
            "show_alert": alert,
        },
    )


def resolve_payment_message(
    *, chat_id: str | int, message_id: int, original_text: str, outcome: str, reviewer: str
) -> bool:
    """Rewrite the original notification so the decision is visible in the chat.

    The keyboard is dropped by omitting ``reply_markup``, which is what stops a
    second operator from pressing a button that has already been spent. The
    server would refuse it anyway; removing it keeps the chat honest.
    """

    banner = "✅ Approved" if outcome == "approve" else "❌ Rejected"
    body = "\n".join((original_text.strip(), "", f"{banner} — {reviewer}"))
    return _call(
        "editMessageText",
        {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": body[:4096],
            # Telegram retains an existing inline keyboard when reply_markup is
            # omitted.  An explicit empty keyboard is the documented way to
            # remove spent Approve/Reject buttons after a terminal decision.
            "reply_markup": {"inline_keyboard": []},
        },
    )

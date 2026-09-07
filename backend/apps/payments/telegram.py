import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

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
                *(
                    (f"📅 Current expiry: {self.current_expiry}",)
                    if self.current_expiry
                    else ()
                ),
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


def notify_manual_payment(message: ManualPaymentTelegramMessage) -> bool:
    """Best-effort isolated Telegram adapter; no credentials means a safe no-op."""
    if not _event_enabled(message.event):
        return False
    token = str(getattr(settings, "TELEGRAM_BOT_TOKEN", "")).strip()
    chat_id = str(
        getattr(settings, "TELEGRAM_ADMIN_CHAT_ID", "")
        or getattr(settings, "TELEGRAM_PAYMENT_CHAT_ID", "")
    ).strip()
    if not token or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": message.render()}).encode()
    request = Request(  # noqa: S310 - the Telegram API origin is fixed above.
        url,
        data=payload,
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
        # Payment submission is authoritative in the database. Telegram is a
        # replaceable notification channel and must never roll it back.
        return False

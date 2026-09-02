import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings


@dataclass(frozen=True, slots=True)
class ManualPaymentTelegramMessage:
    payment_id: str
    plan: str
    amount: str
    submitted: str

    def render(self) -> str:
        return "\n".join(
            (
                "New Lock-in Payment",
                "A manual recharge submission is awaiting review.",
                f"Plan: {self.plan}",
                f"Amount: {self.amount}",
                f"Submitted: {self.submitted}",
                f"Internal payment reference: {self.payment_id}",
            )
        )


def notify_manual_payment(message: ManualPaymentTelegramMessage) -> bool:
    """Best-effort isolated Telegram adapter; no credentials means a safe no-op."""
    token = str(getattr(settings, "TELEGRAM_BOT_TOKEN", "")).strip()
    chat_id = str(getattr(settings, "TELEGRAM_PAYMENT_CHAT_ID", "")).strip()
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

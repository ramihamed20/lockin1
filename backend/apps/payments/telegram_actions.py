"""Approve or reject a manual payment from a Telegram button.

This module is an adapter, not a second implementation. Every decision still
goes through ``review_manual_recharge`` -- the same function the operations
console calls -- so subscription activation, early-renewal roll-back,
idempotency, invoicing, notifications and audit behave identically whichever
button was pressed.

What lives here is only the part Telegram needs: deciding whether an update is
allowed to act, turning it into one call, and writing the outcome back into the
chat.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from django.conf import settings

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import has_operational_capability

from .manual_services import ManualPaymentError, review_manual_recharge
from .models import ManualRechargeSubmission, TelegramPaymentOperator
from .telegram import (
    TelegramCallbackError,
    answer_callback_query,
    authorized_chat_ids,
    parse_callback_data,
    resolve_payment_message,
)

logger = logging.getLogger("lockin.telegram")

# Recorded on the audit trail so a review made from a chat button is
# distinguishable from one made in the operations console. Both run the same
# service; only the channel differs.
TELEGRAM_REVIEW_SOURCE = "payments.telegram"


class TelegramAuthorizationError(Exception):
    """The update may not act on payments. Never tells the caller why.

    ``code`` is a coarse machine-readable class of refusal. It is for the
    deployment's own metrics, never for the chat: the four refusals are
    indistinguishable to a presser by design, but an operator looking at a
    dashboard should not have to grep logs to learn that every button in the
    deployment is failing because no operator is linked.
    """

    def __init__(self, message: str, *, code: str = "unknown") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class CallbackOutcome:
    handled: bool
    message: str
    changed: bool = False


def _text(value: Any, limit: int = 200) -> str:
    return value[:limit] if isinstance(value, str) else ""


def resolve_operator(*, telegram_user_id: str) -> TelegramPaymentOperator:
    """Find the Lock-in administrator behind a Telegram account.

    Two independent conditions, both current at the moment of the click: the
    link exists and is active, and the linked account still holds
    ``payments.manage``. Capability is never cached on the link, so revoking it
    in the operations console revokes the Telegram button in the same instant.
    """

    operator = (
        TelegramPaymentOperator.objects.select_related("user")
        .filter(telegram_user_id=telegram_user_id, is_active=True)
        .first()
    )
    if operator is None:
        raise TelegramAuthorizationError(
            "No active operator link for this Telegram account. Link one with "
            "`manage.py telegram_operator --link <id> --user <email>`.",
            code="no_operator_link",
        )
    user = operator.user
    if not isinstance(user, User) or user.status != User.Status.ACTIVE or not user.is_active:
        raise TelegramAuthorizationError(
            "The linked Lock-in account is not active.", code="inactive_account"
        )
    if not has_operational_capability(user, Capability.PAYMENTS_MANAGE):
        raise TelegramAuthorizationError(
            "The linked account cannot manage payments.", code="missing_capability"
        )
    return operator


def _idempotency_key(*, payment_id: UUID, action: str) -> str:
    """One key per payment and action, so a redelivery is the same request.

    Telegram retries an update it did not get a 2xx for, and two operators can
    press the same button within the same second. Both arrive here with the same
    key, and ``review_manual_recharge`` records the transition once.
    """

    return f"telegram-review:{payment_id}:{action}"


def handle_callback_query(*, callback_query: dict[str, Any]) -> CallbackOutcome:
    """Authorize, act, and report back into the chat.

    Raises ``TelegramAuthorizationError`` for an update that may not act at all.
    Everything else -- unknown payment, already reviewed, a rule refusing the
    transition -- is answered in the chat and reported as handled, because it is
    a real answer rather than a reason to make Telegram retry.
    """

    callback_id = _text(callback_query.get("id"), 64)
    sender = callback_query.get("from") or {}
    message = callback_query.get("message") or {}
    chat = message.get("chat") or {}

    chat_id = str(chat.get("id", "")).strip()
    if not chat_id or chat_id not in authorized_chat_ids():
        raise TelegramAuthorizationError(
            "Update did not originate in an authorized chat.", code="unauthorized_chat"
        )

    telegram_user_id = str(sender.get("id", "")).strip()
    if not telegram_user_id:
        raise TelegramAuthorizationError("Update carries no Telegram sender.", code="no_sender")
    operator = resolve_operator(telegram_user_id=telegram_user_id)

    try:
        action, payment_id = parse_callback_data(_text(callback_query.get("data"), 64))
    except TelegramCallbackError as error:
        # A button signed by a previous deployment lands here: the signing key is
        # derived from the bot token, webhook secret and SECRET_KEY, so rotating
        # any of them invalidates every button already sitting in the chat.
        raise TelegramAuthorizationError(str(error), code="callback_signature") from error

    outcome = _review(
        payment_id=payment_id,
        action=action,
        operator=operator,
        reviewer=_reviewer_label(operator),
    )

    if callback_id:
        answer_callback_query(callback_query_id=callback_id, text=outcome.message)
    if outcome.changed:
        message_id = message.get("message_id")
        if isinstance(message_id, int):
            resolve_payment_message(
                chat_id=chat_id,
                message_id=message_id,
                original_text=_text(message.get("text"), 4096),
                outcome=action,
                reviewer=_reviewer_label(operator),
            )
    return outcome


def _reviewer_label(operator: TelegramPaymentOperator) -> str:
    """Identify the reviewer without leaking an address into a group chat."""

    return operator.label.strip() or operator.user.username or "Lock-in operator"


def _review(
    *, payment_id: UUID, action: str, operator: TelegramPaymentOperator, reviewer: str
) -> CallbackOutcome:
    reason = f"{action.title()}d from Telegram by {reviewer}."
    try:
        submission, changed = review_manual_recharge(
            payment_id=payment_id,
            actor=operator.user,
            decision=action,
            reason=reason,
            idempotency_key=_idempotency_key(payment_id=payment_id, action=action),
            send_notification=False,
            source=TELEGRAM_REVIEW_SOURCE,
        )
    except ManualRechargeSubmission.DoesNotExist:
        # Not an error worth retrying, and worth answering vaguely: the chat is
        # not a place to confirm which identifiers exist.
        logger.warning(
            "Telegram review referenced an unknown payment",
            extra={"payment_id": str(payment_id), "action": action},
        )
        return CallbackOutcome(handled=True, message="This request is no longer available.")
    except ManualPaymentError as error:
        # Already reviewed the other way, or a rule refused it. Harmless, and
        # the operator is told plainly.
        return CallbackOutcome(handled=True, message=str(error)[:200])

    if not changed:
        return CallbackOutcome(
            handled=True,
            message=f"Already {submission.status}. No change was made.",
        )
    verb = "approved" if action == "approve" else "rejected"
    return CallbackOutcome(handled=True, message=f"Payment {verb}.", changed=True)


def webhook_secret() -> str:
    return str(getattr(settings, "TELEGRAM_WEBHOOK_SECRET_TOKEN", "")).strip()

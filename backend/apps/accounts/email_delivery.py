"""Durable, bounded account-email worker. SMTP is intentionally outside HTTP."""

import hashlib
import logging
import re
import smtplib
from datetime import timedelta

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac

from platform_core.observability import providers

from .models import AccountEmailDelivery, OneTimeToken, User

MAX_ATTEMPTS = 5
CLAIM_SECONDS = 300

logger = logging.getLogger("lockin.email")

# The enhanced status code ("5.7.26") is what tells a Gmail authentication
# rejection apart from a full mailbox or a bad address. It is a protocol code,
# never personal data -- unlike the reply text around it, which can quote the
# recipient address and is therefore never stored or logged.
_ENHANCED_STATUS = re.compile(r"\b([245]\.\d{1,3}\.\d{1,3})\b")

# Recorded when a code or link is no longer worth sending: a newer one replaced
# it, it was already used, or it expired while the queue was behind.
STALE_LINK_OUTCOME = "TokenNoLongerUsable"


def _enhanced_status(message: object) -> str:
    text = message.decode("utf-8", "replace") if isinstance(message, bytes) else str(message)
    match = _ENHANCED_STATUS.search(text)
    return match.group(1) if match else ""


def _smtp_reply(error: BaseException) -> tuple[int | None, str]:
    """The numeric SMTP reply code and enhanced status, when the error has one."""

    if isinstance(error, smtplib.SMTPRecipientsRefused):
        replies = list(error.recipients.values())
        if not replies:
            return None, ""
        code, message = replies[0]
        return int(code), _enhanced_status(message)
    if isinstance(error, smtplib.SMTPResponseException):
        return int(error.smtp_code), _enhanced_status(error.smtp_error)
    return None, ""


def failure_code(error: BaseException) -> str:
    """A privacy-safe label for a failed send: the error type plus SMTP codes."""

    code, enhanced = _smtp_reply(error)
    parts = [type(error).__name__]
    if code is not None:
        parts.append(str(code))
    if enhanced:
        parts.append(enhanced)
    return ":".join(parts)[:240]


def is_permanent_failure(error: BaseException) -> bool:
    """A 5xx answer about *this message* will be the same on every retry.

    Retrying a refused recipient or a rejected message only repeats the
    rejection and counts against the sender's reputation. Authentication and
    connection problems are about the server, not the message, so they keep the
    normal back-off: fixing the configuration lets the queue drain by itself.
    """

    if isinstance(error, smtplib.SMTPAuthenticationError):
        return False
    code, _ = _smtp_reply(error)
    return code is not None and 500 <= code < 600


# How long a queued message may wait before the queue counts as behind. The
# worker runs every minute; three missed runs is no longer "a moment".
BACKLOG_SECONDS = 180
RECENT_FAILURE_WINDOW = timedelta(minutes=15)


def account_email_delivery_state() -> str:
    """ "queued" while mail is flowing, "delayed" while it visibly is not.

    It describes the mail system, never the address in a request: every
    caller gets the same answer at the same moment, so it cannot be used to
    learn whether an account exists. It is a hint, not a delivery receipt --
    the provider can still bounce or filter a message after this says
    "queued".
    """

    now = timezone.now()
    waiting = AccountEmailDelivery.objects.filter(
        status__in=(AccountEmailDelivery.Status.PENDING, AccountEmailDelivery.Status.SENDING),
        created_at__lte=now - timedelta(seconds=BACKLOG_SECONDS),
    )
    if waiting.exists():
        return "delayed"
    latest_failure = (
        AccountEmailDelivery.objects.filter(
            status=AccountEmailDelivery.Status.FAILED,
            failed_at__gte=now - RECENT_FAILURE_WINDOW,
        )
        .exclude(last_error=STALE_LINK_OUTCOME)
        # A refused recipient is about one address (a typo'd domain, a full
        # mailbox), not about mail flowing: it must not tell everyone else
        # their email is delayed.
        .exclude(last_error__startswith="SMTPRecipientsRefused")
        .order_by("-failed_at")
        .values_list("failed_at", flat=True)
        .first()
    )
    if latest_failure is None:
        return "queued"
    sent_since = AccountEmailDelivery.objects.filter(
        status=AccountEmailDelivery.Status.SENT, sent_at__gt=latest_failure
    ).exists()
    return "queued" if sent_since else "delayed"


def _record(event: str, delivery: AccountEmailDelivery, **fields: object) -> None:
    # Only the recipient's domain: enough to see "every gmail.com send fails",
    # never enough to identify the person. Never the code, link or body.
    flow = str(delivery.token.kind)
    providers.metric_sink.increment(
        "accounts.email.delivery", attributes={"flow": flow, "outcome": event}
    )
    log = logger.warning if event in {"retry_scheduled", "failed"} else logger.info
    log(
        "Account email %s",
        event,
        extra={
            "event": f"account_email.{event}",
            "delivery_id": str(delivery.id),
            "flow": flow,
            "attempt": delivery.attempts,
            "recipient_domain": delivery.recipient.rpartition("@")[2].lower(),
            **fields,
        },
    )


def _cipher() -> Fernet:
    # The application secret already protects Django's signed state. Deriving a
    # separate Fernet key prevents raw, single-use URLs being stored as plain DB
    # text without adding a second production secret to manage.
    key = salted_hmac(
        "accounts.email-delivery",
        "fernet",
        secret=settings.SECRET_KEY,
        algorithm=hashlib.sha256().name,
    ).digest()
    import base64

    return Fernet(base64.urlsafe_b64encode(key))


def enqueue_account_email(
    *, user: User, token: OneTimeToken, subject: str, body: str
) -> AccountEmailDelivery:
    encrypted_body = _cipher().encrypt(body.encode("utf-8")).decode("ascii")
    return AccountEmailDelivery.objects.get_or_create(
        token=token,
        defaults={"recipient": user.email, "subject": subject, "encrypted_body": encrypted_body},
    )[0]


def _delay(attempt: int) -> timedelta:
    return timedelta(seconds=min(3600, 30 * (2 ** max(0, attempt - 1))))


def dispatch_due_account_emails(*, limit: int = 50) -> int:
    delivered = 0
    now = timezone.now()
    for delivery_id in (
        AccountEmailDelivery.objects.filter(
            status__in=(AccountEmailDelivery.Status.PENDING, AccountEmailDelivery.Status.SENDING),
            next_attempt_at__lte=now,
        )
        .order_by("next_attempt_at")
        .values_list("id", flat=True)[:limit]
    ):
        with transaction.atomic():
            delivery = (
                AccountEmailDelivery.objects.select_for_update(skip_locked=True)
                .select_related("token")
                .filter(id=delivery_id)
                .first()
            )
            if delivery is None or delivery.status in {
                AccountEmailDelivery.Status.SENT,
                AccountEmailDelivery.Status.FAILED,
            }:
                continue
            claimed_at = timezone.now()
            # Candidate ids were read before this lock. Another worker may
            # have claimed this row since then; SENDING alone is not a lease.
            if delivery.next_attempt_at > claimed_at:
                continue
            # A queue that fell behind must not deliver a code the reader can no
            # longer use: a resend already replaced it, or it has expired. Two
            # codes arriving together, the first one dead, is worse than one.
            if not delivery.token.is_usable:
                delivery.status = AccountEmailDelivery.Status.FAILED
                delivery.failed_at = claimed_at
                delivery.last_error = STALE_LINK_OUTCOME
                delivery.save(update_fields=("status", "failed_at", "last_error", "updated_at"))
                _record("skipped_stale", delivery)
                continue
            delivery.status = AccountEmailDelivery.Status.SENDING
            delivery.attempts += 1
            attempt = delivery.attempts
            delivery.next_attempt_at = claimed_at + timedelta(seconds=CLAIM_SECONDS)
            delivery.save(update_fields=("status", "attempts", "next_attempt_at", "updated_at"))
        try:
            body = _cipher().decrypt(delivery.encrypted_body.encode("ascii")).decode("utf-8")
            send_mail(
                delivery.subject,
                body,
                settings.DEFAULT_FROM_EMAIL,
                [delivery.recipient],
                fail_silently=False,
            )
        except Exception as error:  # SMTP outages must be durable and observable.
            with transaction.atomic():
                delivery = (
                    AccountEmailDelivery.objects.select_for_update()
                    .select_related("token")
                    .get(id=delivery_id)
                )
                if (
                    delivery.attempts != attempt
                    or delivery.status != AccountEmailDelivery.Status.SENDING
                ):
                    continue
                terminal = delivery.attempts >= MAX_ATTEMPTS or is_permanent_failure(error)
                delivery.status = (
                    AccountEmailDelivery.Status.FAILED
                    if terminal
                    else AccountEmailDelivery.Status.PENDING
                )
                failed_at = timezone.now()
                delivery.next_attempt_at = failed_at + _delay(delivery.attempts)
                delivery.failed_at = failed_at if terminal else None
                delivery.last_error = failure_code(error)
                delivery.save(
                    update_fields=(
                        "status",
                        "next_attempt_at",
                        "failed_at",
                        "last_error",
                        "updated_at",
                    )
                )
            _record(
                "failed" if terminal else "retry_scheduled",
                delivery,
                error_code=delivery.last_error,
            )
            continue
        with transaction.atomic():
            delivery = (
                AccountEmailDelivery.objects.select_for_update()
                .select_related("token")
                .get(id=delivery_id)
            )
            if (
                delivery.attempts != attempt
                or delivery.status != AccountEmailDelivery.Status.SENDING
            ):
                continue
            delivery.status = AccountEmailDelivery.Status.SENT
            delivery.sent_at = timezone.now()
            delivery.last_error = ""
            delivery.save(update_fields=("status", "sent_at", "last_error", "updated_at"))
        # "Accepted by the SMTP server", not "in the inbox": the provider may
        # still bounce, defer or filter the message after this point.
        _record("provider_accepted", delivery)
        delivered += 1
    return delivered

"""Durable, bounded account-email worker. SMTP is intentionally outside HTTP."""

from datetime import timedelta

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac

from .models import AccountEmailDelivery, OneTimeToken, User

MAX_ATTEMPTS = 5


def _cipher() -> Fernet:
    # The application secret already protects Django's signed state. Deriving a
    # separate Fernet key prevents raw, single-use URLs being stored as plain DB
    # text without adding a second production secret to manage.
    key = salted_hmac("accounts.email-delivery", "fernet", secret=settings.SECRET_KEY).digest()
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
                .filter(id=delivery_id)
                .first()
            )
            if delivery is None or delivery.status in {
                AccountEmailDelivery.Status.SENT,
                AccountEmailDelivery.Status.FAILED,
            }:
                continue
            delivery.status = AccountEmailDelivery.Status.SENDING
            delivery.attempts += 1
            delivery.save(update_fields=("status", "attempts", "updated_at"))
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
                delivery = AccountEmailDelivery.objects.select_for_update().get(id=delivery_id)
                terminal = delivery.attempts >= MAX_ATTEMPTS
                delivery.status = (
                    AccountEmailDelivery.Status.FAILED
                    if terminal
                    else AccountEmailDelivery.Status.PENDING
                )
                delivery.next_attempt_at = now + _delay(delivery.attempts)
                delivery.failed_at = now if terminal else None
                delivery.last_error = type(error).__name__[:240]
                delivery.save(
                    update_fields=(
                        "status",
                        "next_attempt_at",
                        "failed_at",
                        "last_error",
                        "updated_at",
                    )
                )
            continue
        with transaction.atomic():
            delivery = AccountEmailDelivery.objects.select_for_update().get(id=delivery_id)
            delivery.status = AccountEmailDelivery.Status.SENT
            delivery.sent_at = timezone.now()
            delivery.last_error = ""
            delivery.save(update_fields=("status", "sent_at", "last_error", "updated_at"))
        delivered += 1
    return delivered

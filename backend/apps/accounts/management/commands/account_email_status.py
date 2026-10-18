"""Answer "are account emails leaving this server?" without reading anyone's mail.

Everything printed here is safe to paste into an incident thread: counts,
ages, protocol error codes, recipient *domains*, and the non-secret parts of the
mail configuration. No address, code, link, body or credential is ever shown.

    python manage.py account_email_status
    python manage.py account_email_status --check-connection
    python manage.py account_email_status --send-test-to someone@example.com

The last two talk to the configured SMTP server. A test send proves only that
the provider *accepted* the message; whether it reached the inbox (or the spam
folder) has to be checked in that mailbox.
"""

import contextlib
from datetime import datetime, timedelta
from urllib.parse import urlparse

from django.conf import settings
from django.core.mail import get_connection, send_mail
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db.models import Count, Min
from django.utils import timezone

from apps.accounts.email_delivery import failure_code
from apps.accounts.models import AccountEmailDelivery

SCHEDULER_JOB = "account_email_delivery"
# Two missed dispatch intervals plus the scheduler's own poll: past this the
# queue is not being drained, whatever the reason.
STALE_PENDING_SECONDS = 300


def _domain(address: str) -> str:
    return address.rpartition("@")[2].lower() or "?"


class Command(BaseCommand):
    help = "Report account-email queue health and, optionally, test the SMTP connection."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--hours", type=int, default=24, help="Window for recent outcomes.")
        parser.add_argument(
            "--check-connection",
            action="store_true",
            help="Open and authenticate an SMTP connection, then close it. Sends nothing.",
        )
        parser.add_argument(
            "--send-test-to",
            default="",
            help="Send one plain test message to this authorized mailbox.",
        )

    def handle(self, *args: object, **options: object) -> None:
        del args
        now = timezone.now()
        hours = max(1, int(str(options["hours"])))
        self._configuration()
        self._scheduler(now)
        self._queue(now, hours)
        if options["check_connection"]:
            self._check_connection()
        recipient = str(options["send_test_to"] or "").strip()
        if recipient:
            self._send_test(recipient)

    def _line(self, label: str, value: object) -> None:
        self.stdout.write(f"  {label:<28} {value}")

    def _configuration(self) -> None:
        self.stdout.write("Configuration")
        backend = str(settings.EMAIL_BACKEND)
        self._line("backend", backend.rsplit(".", 2)[-2] if "." in backend else backend)
        self._line("host", getattr(settings, "EMAIL_HOST", "") or "-")
        self._line("port", getattr(settings, "EMAIL_PORT", "-"))
        self._line("tls / ssl", f"{settings.EMAIL_USE_TLS} / {settings.EMAIL_USE_SSL}")
        self._line("timeout seconds", getattr(settings, "EMAIL_TIMEOUT", None))
        self._line("credentials set", bool(getattr(settings, "EMAIL_HOST_PASSWORD", "")))
        sender = str(settings.DEFAULT_FROM_EMAIL)
        self._line("sender domain", _domain(sender.rstrip(">")))
        app_host = urlparse(str(settings.PUBLIC_APP_URL)).hostname or "?"
        self._line("reset links point to", app_host)
        port = int(getattr(settings, "EMAIL_PORT", 0) or 0)
        # Port 465 speaks TLS from the first byte; 587 starts plain and
        # upgrades. Mixing them up does not fail fast -- the client waits for
        # a greeting that never comes and every send ends in a timeout.
        if port == 465 and settings.EMAIL_USE_TLS and not settings.EMAIL_USE_SSL:
            self.stdout.write(
                self.style.ERROR("  ! Port 465 needs EMAIL_USE_SSL=true and EMAIL_USE_TLS=false.")
            )
        if port == 587 and settings.EMAIL_USE_SSL:
            self.stdout.write(
                self.style.ERROR("  ! Port 587 needs EMAIL_USE_TLS=true and EMAIL_USE_SSL=false.")
            )
        if "console" in backend or "locmem" in backend or "dummy" in backend:
            self.stdout.write(self.style.WARNING("  ! This backend never delivers mail."))
        if app_host in {"localhost", "127.0.0.1"} or app_host.endswith(".trycloudflare.com"):
            self.stdout.write(self.style.WARNING("  ! Reset links point at a non-public host."))

    def _scheduler(self, now: datetime) -> None:
        self.stdout.write("Scheduler")
        try:
            from apps.operations_integrations.models import ScheduledJobState

            state = ScheduledJobState.objects.filter(code=SCHEDULER_JOB).first()
        except Exception as error:  # noqa: BLE001 - a status report must not crash
            self._line("state", f"unavailable ({type(error).__name__})")
            return
        if state is None:
            self.stdout.write(
                self.style.ERROR(
                    "  ! The email job has never run: no operations scheduler has "
                    "claimed it. Nothing in the queue will ever be sent."
                )
            )
            return
        self._line("status", state.status)
        self._line("last started", state.last_started_at or "never")
        self._line("last succeeded", state.last_succeeded_at or "never")
        self._line("last failed", state.last_failed_at or "never")
        self._line("last error", state.last_error_code or "-")
        self._line("runs / failures", f"{state.run_count} / {state.failure_count}")
        if state.last_succeeded_at is None or state.last_succeeded_at < now - timedelta(
            seconds=STALE_PENDING_SECONDS
        ):
            self.stdout.write(
                self.style.ERROR("  ! The email job has not succeeded in the last few minutes.")
            )

    def _queue(self, now: datetime, hours: int) -> None:
        self.stdout.write(f"Queue (last {hours}h)")
        recent = AccountEmailDelivery.objects.filter(created_at__gte=now - timedelta(hours=hours))
        rows = (
            recent.values("token__kind", "status")
            .annotate(total=Count("id"))
            .order_by("token__kind", "status")
        )
        if not rows:
            self._line("messages", 0)
        for row in rows:
            self._line(f"{row['token__kind']} / {row['status']}", row["total"])

        waiting = AccountEmailDelivery.objects.filter(
            status__in=(AccountEmailDelivery.Status.PENDING, AccountEmailDelivery.Status.SENDING)
        )
        oldest = waiting.aggregate(oldest=Min("created_at"))["oldest"]
        self._line("waiting now", waiting.count())
        if oldest is not None:
            age = int((now - oldest).total_seconds())
            self._line("oldest waiting (seconds)", age)
            if age > STALE_PENDING_SECONDS:
                self.stdout.write(
                    self.style.ERROR("  ! Messages are waiting longer than the queue should allow.")
                )

        failures = (
            recent.exclude(last_error="").values("last_error", "recipient").order_by("last_error")
        )
        by_code: dict[tuple[str, str], int] = {}
        for failure in failures:
            key = (failure["last_error"], _domain(failure["recipient"]))
            by_code[key] = by_code.get(key, 0) + 1
        if by_code:
            self.stdout.write("Errors (code, recipient domain, count)")
            for (code, domain), total in sorted(by_code.items(), key=lambda item: -item[1]):
                self._line(f"{code} @ {domain}", total)

    def _check_connection(self) -> None:
        self.stdout.write("SMTP connection")
        connection = get_connection(fail_silently=False)
        try:
            connection.open()
        except Exception as error:  # noqa: BLE001 - report, do not crash
            raise CommandError(f"Connection failed: {failure_code(error)}") from None
        finally:
            # Closing a connection that never opened can itself raise.
            with contextlib.suppress(Exception):
                connection.close()
        self.stdout.write(self.style.SUCCESS("  Connected and authenticated. Nothing was sent."))

    def _send_test(self, recipient: str) -> None:
        self.stdout.write("Test message")
        try:
            send_mail(
                "Lock-in mail delivery test",
                "This is a delivery test from Lock-in. No action is needed.",
                settings.DEFAULT_FROM_EMAIL,
                [recipient],
                fail_silently=False,
            )
        except Exception as error:  # noqa: BLE001 - report, do not crash
            raise CommandError(f"The provider refused the test: {failure_code(error)}") from None
        self.stdout.write(
            self.style.SUCCESS(
                f"  Accepted by the SMTP server for {_domain(recipient)}. Check that mailbox "
                "(inbox and spam) to confirm arrival."
            )
        )

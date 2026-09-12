"""Link, list or revoke the Telegram accounts that may review payments.

A Telegram Approve/Reject button resolves the presser to a real Lock-in
administrator through ``TelegramPaymentOperator``. Without a row there is no
actor to record, so the webhook refuses the action -- correctly, but until now
the only way to create one was an undocumented-in-product Django shell snippet.
A feature whose only provisioning path is a shell session is a feature that ends
up shipped and unusable, which is exactly what happened.

This is deliberately a management command and not an API. The link grants the
power to approve money out of band of the session-authenticated console, so
creating one should require host access, not a logged-in browser. Capability is
still read from the linked account at click time, so revoking ``payments.manage``
in the operations console revokes the button whatever this command has recorded.

    python manage.py telegram_operator --list
    python manage.py telegram_operator --link 123456789 --user admin@example.com \
        --label "Night shift"
    python manage.py telegram_operator --revoke 123456789
"""

from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import IntegrityError, transaction

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import has_operational_capability
from apps.payments.models import TelegramPaymentOperator


class Command(BaseCommand):
    help = "Link, list or revoke Telegram accounts allowed to review manual payments."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--list", action="store_true", help="Show every configured link.")
        parser.add_argument("--link", metavar="TELEGRAM_USER_ID", help="Numeric Telegram user id.")
        parser.add_argument("--user", metavar="EMAIL", help="The Lock-in account to link it to.")
        parser.add_argument(
            "--label",
            default="",
            help="Name shown in the chat instead of an address. Optional.",
        )
        parser.add_argument(
            "--revoke",
            metavar="TELEGRAM_USER_ID",
            help="Deactivate a link without deleting its history.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        del args
        chosen = [name for name in ("list", "link", "revoke") if options.get(name)]
        if len(chosen) != 1:
            raise CommandError("Choose exactly one of --list, --link or --revoke.")
        if chosen[0] == "list":
            return self._list()
        if chosen[0] == "revoke":
            return self._revoke(str(options["revoke"]).strip())
        return self._link(
            telegram_user_id=str(options["link"]).strip(),
            email=str(options["user"] or "").strip(),
            label=str(options["label"] or "").strip(),
        )

    def _list(self) -> None:
        operators = TelegramPaymentOperator.objects.select_related("user").all()
        if not operators:
            self.stdout.write(
                self.style.WARNING(
                    "No Telegram operators are linked. Every Approve/Reject button will be "
                    "refused. Link one with --link."
                )
            )
            return
        for operator in operators:
            # Capability is read live, so a link can be active and still unusable.
            capable = has_operational_capability(operator.user, Capability.PAYMENTS_MANAGE)
            state = "active" if operator.is_active else "revoked"
            if operator.is_active and not capable:
                state = "active but lacks payments.manage"
            line = f"{operator.telegram_user_id}  {operator.user.email}  [{state}]"
            self.stdout.write(line if operator.is_active and capable else self.style.WARNING(line))

    @transaction.atomic
    def _link(self, *, telegram_user_id: str, email: str, label: str) -> None:
        if not telegram_user_id.isdigit():
            raise CommandError("A Telegram user id is numeric. Pass the id, not the @username.")
        if not email:
            raise CommandError("Pass --user with the Lock-in account's email address.")
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            raise CommandError("No Lock-in account has that email address.")
        if user.status != User.Status.ACTIVE or not user.is_active:
            raise CommandError("That Lock-in account is not active.")
        if not has_operational_capability(user, Capability.PAYMENTS_MANAGE):
            # Refuse rather than create a link that silently never works. This
            # is the failure mode this command exists to make impossible.
            raise CommandError(
                f"{user.email} does not hold payments.manage. Assign it in the operations "
                "console first, then link the Telegram account."
            )
        existing = TelegramPaymentOperator.objects.filter(telegram_user_id=telegram_user_id).first()
        if existing is not None and existing.user_id != user.id:
            raise CommandError(
                "That Telegram account is already linked to a different Lock-in account. "
                "Revoke it first."
            )
        try:
            operator, created = TelegramPaymentOperator.objects.update_or_create(
                telegram_user_id=telegram_user_id,
                defaults={"user": user, "label": label, "is_active": True},
            )
        except IntegrityError as error:
            # user is one-to-one: the account may already act through another id.
            raise CommandError(
                f"{user.email} is already linked to another Telegram account."
            ) from error
        self.stdout.write(
            self.style.SUCCESS(
                f"{'Linked' if created else 'Updated'} {operator.telegram_user_id} -> {user.email}."
            )
        )

    def _revoke(self, telegram_user_id: str) -> None:
        updated = TelegramPaymentOperator.objects.filter(telegram_user_id=telegram_user_id).update(
            is_active=False
        )
        if not updated:
            raise CommandError("No link exists for that Telegram user id.")
        # The row is kept: it is the actor on past reviews in the audit trail.
        self.stdout.write(self.style.SUCCESS(f"Revoked {telegram_user_id}. History is retained."))

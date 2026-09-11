from django.core.management.base import BaseCommand

from apps.accounts.email_delivery import dispatch_due_account_emails


class Command(BaseCommand):
    help = "Deliver due verification and password-reset emails with bounded retry."

    def handle(self, *args: object, **options: object) -> None:
        del args, options
        self.stdout.write(f"Delivered {dispatch_due_account_emails()} account emails.")

from django.core.management.base import BaseCommand

from apps.accounts.models import User
from apps.entitlements.services import sync_subscription_entitlements
from apps.invoices.services import issue_paid_invoice
from apps.payments.models import Payment
from apps.provider_integrations.models import ProviderEvent
from apps.provider_integrations.services import process_provider_event
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import create_trial_for_user, refresh_subscription


class Command(BaseCommand):
    help = (
        "Reconcile authoritative Phase 8 subscriptions, entitlements, invoices, "
        "and provider events."
    )

    def handle(self, *args: object, **options: object) -> None:
        trials = 0
        for user in User.objects.filter(
            is_active=True, email_verified_at__isnull=False, subscription_accounts__isnull=True
        ).iterator(chunk_size=500):
            _, created = create_trial_for_user(user=user, source_reference="reconciliation")
            trials += int(created)

        subscriptions = 0
        for subscription in Subscription.objects.select_related("plan_version").iterator(
            chunk_size=500
        ):
            current = refresh_subscription(subscription=subscription)
            sync_subscription_entitlements(subscription_id=current.id)
            subscriptions += 1

        invoices = 0
        succeeded = Payment.objects.filter(status=Payment.Status.SUCCEEDED, invoice__isnull=True)
        for payment in succeeded.iterator(chunk_size=500):
            _, created = issue_paid_invoice(payment_id=payment.id)
            invoices += int(created)

        events = 0
        recoverable = ProviderEvent.objects.filter(
            status__in=(ProviderEvent.Status.VERIFIED, ProviderEvent.Status.FAILED)
        )
        for event in recoverable.iterator(chunk_size=500):
            try:
                processed = process_provider_event(provider_event_id=event.id)
            except Exception as error:  # noqa: BLE001 - reconciliation continues per record
                self.stderr.write(f"Provider event {event.id} remains failed: {error}")
            else:
                events += int(
                    processed.status
                    in (ProviderEvent.Status.PROCESSED, ProviderEvent.Status.IGNORED)
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"Created {trials} trials; reconciled {subscriptions} subscriptions; "
                f"created {invoices} invoices; processed {events} provider events."
            )
        )

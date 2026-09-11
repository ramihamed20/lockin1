import logging
from collections.abc import Callable, Iterator
from typing import TypeVar

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.entitlements.services import sync_subscription_entitlements
from apps.invoices.services import issue_paid_invoice
from apps.payments.models import Payment
from apps.provider_integrations.models import ProviderEvent
from apps.provider_integrations.services import process_provider_event
from apps.subscriptions.models import Subscription
from apps.subscriptions.services import create_trial_for_user, refresh_subscription
from platform_core.observability import providers

logger = logging.getLogger("lockin.jobs")

Record = TypeVar("Record")


class Command(BaseCommand):
    help = (
        "Reconcile authoritative Phase 8 subscriptions, entitlements, invoices, "
        "and provider events."
    )

    failures = 0

    def handle(self, *args: object, **options: object) -> None:
        self.failures = 0

        trials = self._each(
            User.objects.filter(
                is_active=True, email_verified_at__isnull=False, subscription_accounts__isnull=True
            ).iterator(chunk_size=500),
            stage="trial",
            identify=lambda user: str(user.id),
            handle=lambda user: int(
                create_trial_for_user(user=user, source_reference="reconciliation")[1]
            ),
        )

        subscriptions = self._each(
            Subscription.objects.select_related("plan_version").iterator(chunk_size=500),
            stage="subscription",
            identify=lambda subscription: str(subscription.id),
            handle=self._reconcile_subscription,
        )

        invoices = self._each(
            Payment.objects.filter(status=Payment.Status.SUCCEEDED, invoice__isnull=True).iterator(
                chunk_size=500
            ),
            stage="invoice",
            identify=lambda payment: str(payment.id),
            handle=lambda payment: int(issue_paid_invoice(payment_id=payment.id)[1]),
        )

        events = self._each(
            ProviderEvent.objects.filter(
                status__in=(ProviderEvent.Status.VERIFIED, ProviderEvent.Status.FAILED)
            ).iterator(chunk_size=500),
            stage="provider_event",
            identify=lambda event: str(event.id),
            handle=self._process_event,
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Created {trials} trials; reconciled {subscriptions} subscriptions; "
                f"created {invoices} invoices; processed {events} provider events."
            )
        )
        if self.failures:
            # Every record was still attempted. Failing the command at the end is
            # what puts the run in the scheduler's failed state and on the
            # operations.job.failed metric, so a persistent bad record stays
            # visible instead of being reported as a clean reconciliation.
            raise CommandError(
                f"{self.failures} record(s) could not be reconciled; see lockin.jobs logs."
            )

    def _each(
        self,
        records: Iterator[Record],
        *,
        stage: str,
        identify: Callable[[Record], str],
        handle: Callable[[Record], int],
    ) -> int:
        """Apply ``handle`` to every record, isolating one record's failure from the rest.

        Reconciliation is a repair pass over the whole estate: one unreadable row
        used to abort the run for every account behind it, which is precisely
        when the repair is needed most.
        """

        succeeded = 0
        for record in records:
            try:
                succeeded += handle(record)
            except Exception as error:  # noqa: BLE001 - one record must not stop the pass
                self.failures += 1
                identifier = identify(record)
                logger.exception(
                    "Commerce reconciliation skipped a record",
                    extra={"stage": stage, "record_id": identifier},
                )
                providers.metric_sink.increment(
                    "commerce.reconciliation.record_failed", attributes={"stage": stage}
                )
                # Identifiers only: the message may reach an operator's console.
                self.stderr.write(f"{stage} {identifier} could not be reconciled: {error}")
        return succeeded

    def _reconcile_subscription(self, subscription: Subscription) -> int:
        current = refresh_subscription(subscription=subscription)
        sync_subscription_entitlements(subscription_id=current.id)
        return 1

    def _process_event(self, event: ProviderEvent) -> int:
        processed = process_provider_event(provider_event_id=event.id)
        return int(
            processed.status in (ProviderEvent.Status.PROCESSED, ProviderEvent.Status.IGNORED)
        )

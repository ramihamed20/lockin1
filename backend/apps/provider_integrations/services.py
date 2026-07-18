import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.payments.models import Payment
from apps.refunds.models import Refund
from apps.refunds.services import mark_refund_pending
from platform_core.events import publish_after_commit

from .adapters import ProviderVerificationError, configured_provider
from .events import ProviderEventVerified
from .models import ProviderEvent, ProviderObjectLink, WebhookAttempt


@dataclass(frozen=True, slots=True)
class IngestResult:
    event: ProviderEvent
    created: bool


@transaction.atomic
def create_checkout_session(*, payment: Payment) -> dict[str, object]:
    provider = configured_provider()
    session = provider.create_checkout(payment_id=str(payment.id))
    external_id = str(session["reference"])
    ProviderObjectLink.objects.get_or_create(
        provider=provider.code,
        object_type=ProviderObjectLink.ObjectType.PAYMENT,
        internal_id=payment.id,
        defaults={"external_id": external_id},
    )
    return session


@transaction.atomic
def create_refund_request(*, refund: Refund) -> dict[str, object]:
    provider = configured_provider()
    response = provider.create_refund(refund_id=str(refund.id))
    external_id = str(response["reference"])
    ProviderObjectLink.objects.get_or_create(
        provider=provider.code,
        object_type=ProviderObjectLink.ObjectType.REFUND,
        internal_id=refund.id,
        defaults={"external_id": external_id},
    )
    mark_refund_pending(refund_id=refund.id, source_reference=external_id)
    return response


def _record_failed_attempt(*, provider: str, digest: str, code: str) -> None:
    WebhookAttempt.objects.create(
        provider=provider,
        payload_digest=digest,
        verified=False,
        failure_code=code[:80],
    )


def ingest_webhook(*, raw_body: bytes, headers: Mapping[str, str]) -> IngestResult:
    provider = configured_provider()
    digest = hashlib.sha256(raw_body).hexdigest()
    if len(raw_body) > settings.PAYMENT_WEBHOOK_MAX_BYTES:
        _record_failed_attempt(provider=provider.code, digest=digest, code="payload_too_large")
        raise ProviderVerificationError("Webhook payload is too large.", code="payload_too_large")
    try:
        normalized = provider.verify_webhook(raw_body=raw_body, headers=headers)
    except ProviderVerificationError as error:
        _record_failed_attempt(provider=provider.code, digest=digest, code=error.code)
        raise
    WebhookAttempt.objects.create(
        provider=provider.code,
        payload_digest=digest,
        verified=True,
    )
    with transaction.atomic():
        event, created = ProviderEvent.objects.get_or_create(
            provider=provider.code,
            external_event_id=normalized.external_event_id,
            defaults={
                "event_type": normalized.event_type,
                "occurred_at": normalized.occurred_at,
                "payload_digest": digest,
                "normalized_data": normalized.data,
            },
        )
        if not created and event.payload_digest != digest:
            raise ProviderVerificationError(
                "Duplicate provider event has different content.", code="duplicate_conflict"
            )
        if created:
            publish_after_commit(
                ProviderEventVerified(
                    provider_event_id=event.id,
                    provider=event.provider,
                    external_event_id=event.external_event_id,
                    event_type=event.event_type,
                )
            )
    return IngestResult(event=event, created=created)


@transaction.atomic
def process_provider_event(*, provider_event_id: UUID) -> ProviderEvent:
    event = ProviderEvent.objects.select_for_update().get(id=provider_event_id)
    if event.status in (ProviderEvent.Status.PROCESSED, ProviderEvent.Status.IGNORED):
        return event
    event.status = ProviderEvent.Status.PROCESSING
    event.processing_error = ""
    event.revision += 1
    event.save(update_fields=("status", "processing_error", "revision"))
    data = event.normalized_data
    object_type = (
        ProviderObjectLink.ObjectType.PAYMENT
        if event.event_type.startswith("payment.")
        else ProviderObjectLink.ObjectType.REFUND
    )
    try:
        link = ProviderObjectLink.objects.get(
            provider=event.provider,
            object_type=object_type,
            external_id=data["object_id"],
        )
        if event.event_type.startswith("payment."):
            from apps.payments.services import apply_provider_payment_state

            payment_status = (
                Payment.Status.SUCCEEDED
                if event.event_type == "payment.succeeded"
                else Payment.Status.FAILED
            )
            apply_provider_payment_state(
                payment_id=link.internal_id,
                to_status=payment_status,
                amount_minor=int(data["amount_minor"]),
                currency=str(data["currency"]),
                effective_at=event.occurred_at,
                provider_event_id=event.id,
                failure_code=str(data.get("failure_code", "")),
            )
        elif event.event_type.startswith("refund."):
            from apps.refunds.services import apply_provider_refund_state

            refund_status = (
                Refund.Status.SUCCEEDED
                if event.event_type == "refund.succeeded"
                else Refund.Status.FAILED
            )
            apply_provider_refund_state(
                refund_id=link.internal_id,
                to_status=refund_status,
                amount_minor=int(data["amount_minor"]),
                currency=str(data["currency"]),
                effective_at=event.occurred_at,
                provider_event_id=event.id,
                failure_code=str(data.get("failure_code", "")),
            )
        else:
            event.status = ProviderEvent.Status.IGNORED
            event.processed_at = timezone.now()
            event.save(update_fields=("status", "processed_at"))
            return event
    except Exception as error:  # noqa: BLE001 - persist isolated provider failures for retry
        event.status = ProviderEvent.Status.FAILED
        event.processing_error = str(error)[:240]
        event.revision += 1
        event.save(update_fields=("status", "processing_error", "revision"))
        return event
    event.status = ProviderEvent.Status.PROCESSED
    event.processed_at = timezone.now()
    event.revision += 1
    event.save(update_fields=("status", "processed_at", "revision"))
    return event

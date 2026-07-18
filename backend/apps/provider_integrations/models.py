import uuid

from django.db import models


class ProviderObjectLink(models.Model):
    class ObjectType(models.TextChoices):
        PAYMENT = "payment", "Payment"
        REFUND = "refund", "Refund"
        SUBSCRIPTION = "subscription", "Subscription"
        INVOICE = "invoice", "Invoice"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.CharField(max_length=40)
    object_type = models.CharField(max_length=20, choices=ObjectType.choices)
    internal_id = models.UUIDField()
    external_id = models.CharField(max_length=180)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("provider", "object_type", "internal_id"),
                name="provider_link_internal_unique",
            ),
            models.UniqueConstraint(
                fields=("provider", "object_type", "external_id"),
                name="provider_link_external_unique",
            ),
        ]
        indexes = [
            models.Index(fields=("provider", "external_id"), name="provider_link_external_idx")
        ]

    def __str__(self) -> str:
        return f"{self.provider}:{self.object_type}:{self.external_id}"


class WebhookAttempt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.CharField(max_length=40)
    payload_digest = models.CharField(max_length=64)
    verified = models.BooleanField(default=False)
    failure_code = models.CharField(max_length=80, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-received_at", "-id")
        indexes = [
            models.Index(
                fields=("provider", "verified", "-received_at"), name="webhook_attempt_state_idx"
            )
        ]

    def __str__(self) -> str:
        return f"{self.provider}:{self.verified}:{self.received_at.isoformat()}"


class ProviderEvent(models.Model):
    class Status(models.TextChoices):
        VERIFIED = "verified", "Verified"
        PROCESSING = "processing", "Processing"
        PROCESSED = "processed", "Processed"
        IGNORED = "ignored", "Ignored"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.CharField(max_length=40)
    external_event_id = models.CharField(max_length=180)
    event_type = models.CharField(max_length=80)
    occurred_at = models.DateTimeField()
    payload_digest = models.CharField(max_length=64)
    normalized_data = models.JSONField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.VERIFIED)
    processing_error = models.CharField(max_length=240, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    revision = models.PositiveBigIntegerField(default=1)

    class Meta:
        ordering = ("-received_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("provider", "external_event_id"), name="provider_event_dedup_unique"
            )
        ]
        indexes = [
            models.Index(fields=("status", "received_at"), name="provider_event_state_idx"),
            models.Index(
                fields=("provider", "event_type", "-occurred_at"), name="provider_event_type_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.provider}:{self.external_event_id}:{self.status}"

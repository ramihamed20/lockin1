import uuid
from typing import Any

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.payments.models import Payment


class Refund(models.Model):
    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="refunds")
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="requested_refunds",
    )
    amount_minor = models.PositiveBigIntegerField()
    currency = models.CharField(max_length=3)
    currency_exponent = models.PositiveSmallIntegerField(default=2)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.REQUESTED)
    reason = models.CharField(max_length=240)
    idempotency_key = models.CharField(max_length=180)
    failure_code = models.CharField(max_length=80, blank=True)
    requested_at = models.DateTimeField()
    succeeded_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-requested_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("payment", "idempotency_key"), name="refund_payment_idempotent"
            ),
            models.CheckConstraint(condition=Q(amount_minor__gt=0), name="refund_amount_positive"),
            models.CheckConstraint(
                condition=Q(currency_exponent__lte=4), name="refund_currency_exponent_valid"
            ),
        ]
        indexes = [
            models.Index(
                fields=("payment", "status", "-requested_at"), name="refund_payment_state_idx"
            ),
            models.Index(fields=("status", "requested_at"), name="refund_state_time_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.id}:{self.status}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.currency = self.currency.upper()
        super().save(*args, **kwargs)


class RefundTransition(models.Model):
    class Source(models.TextChoices):
        ADMIN = "admin", "Administrator"
        PROVIDER = "provider", "Verified provider event"
        RECONCILIATION = "reconciliation", "Reconciliation"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    refund = models.ForeignKey(Refund, on_delete=models.PROTECT, related_name="transitions")
    from_status = models.CharField(max_length=16, choices=Refund.Status.choices, blank=True)
    to_status = models.CharField(max_length=16, choices=Refund.Status.choices)
    source = models.CharField(max_length=16, choices=Source.choices)
    reason_code = models.CharField(max_length=80)
    idempotency_key = models.CharField(max_length=180)
    source_reference = models.CharField(max_length=180, blank=True)
    effective_at = models.DateTimeField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("effective_at", "created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("refund", "idempotency_key"), name="refund_transition_idempotent"
            )
        ]
        indexes = [
            models.Index(fields=("refund", "-effective_at"), name="refund_transition_time_idx"),
            models.Index(
                fields=("source", "source_reference"), name="refund_transition_source_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.refund_id}:{self.from_status}->{self.to_status}"


class RefundClaim(models.Model):
    """One user request and its original receipt clock, independent of payout."""

    class Status(models.TextChoices):
        REQUESTED = "requested", "Awaiting review"
        NEEDS_INFO = "needs_info", "More information needed"
        APPROVED = "approved", "Approved for transfer"
        COMPLETED = "completed", "Transfer recorded"
        REJECTED = "rejected", "Rejected with reason"
        COMPENSATING = "compensating", "Free access until restoration"
        RESOLVED = "resolved", "Service restored"

    class Kind(models.TextChoices):
        VOLUNTARY = "voluntary", "Change of mind"
        PLATFORM_ERROR = "platform_error", "Platform error or unavailable service"
        PAYMENT_ERROR = "payment_error", "Invalid, partial or duplicate payment"
        TERMINATION = "termination", "End installment agreement"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="refund_claims"
    )
    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="claims")
    kind = models.CharField(max_length=24, choices=Kind.choices)
    remedy = models.CharField(max_length=12, default="refund")
    reason = models.CharField(max_length=1000)
    receiver_phone = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.REQUESTED)
    received_at = models.DateTimeField()
    due_at = models.DateTimeField(db_index=True)
    channel = models.CharField(max_length=12, default="website")
    idempotency_key = models.CharField(max_length=180)
    policy_version = models.CharField(max_length=64, blank=True)
    quoted_amount_minor = models.PositiveBigIntegerField(default=0)
    approved_amount_minor = models.PositiveBigIntegerField(null=True, blank=True)
    allocations = models.JSONField(default=list)
    decision_reason = models.CharField(max_length=1000, blank=True)
    transfer_reference = models.CharField(max_length=160, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="reviewed_refund_claims",
        null=True,
        blank=True,
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("received_at", "id")
        constraints = [
            models.UniqueConstraint(fields=("user", "idempotency_key"), name="refund_claim_retry"),
            models.UniqueConstraint(
                fields=("payment",),
                condition=Q(status__in=("requested", "needs_info", "approved", "compensating")),
                name="refund_claim_one_open",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.id}:{self.status}"

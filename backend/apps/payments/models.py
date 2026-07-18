import uuid
from typing import Any

from django.db import models
from django.db.models import Q

from apps.product_catalog.models import Price
from apps.subscriptions.models import Subscription, SubscriptionAccount


class Payment(models.Model):
    class Status(models.TextChoices):
        INITIATED = "initiated", "Initiated"
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"
        PARTIALLY_REFUNDED = "partially_refunded", "Partially refunded"
        REFUNDED = "refunded", "Refunded"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(
        SubscriptionAccount, on_delete=models.PROTECT, related_name="payments"
    )
    subscription = models.ForeignKey(
        Subscription, on_delete=models.PROTECT, related_name="payments"
    )
    price = models.ForeignKey(Price, on_delete=models.PROTECT, related_name="payments")
    amount_minor = models.PositiveBigIntegerField()
    currency = models.CharField(max_length=3)
    currency_exponent = models.PositiveSmallIntegerField(default=2)
    refunded_amount_minor = models.PositiveBigIntegerField(default=0)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.INITIATED)
    idempotency_key = models.CharField(max_length=180)
    price_snapshot = models.JSONField()
    failure_code = models.CharField(max_length=80, blank=True)
    initiated_at = models.DateTimeField()
    succeeded_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("account", "idempotency_key"), name="payment_account_idempotent"
            ),
            models.CheckConstraint(condition=Q(amount_minor__gt=0), name="payment_amount_positive"),
            models.CheckConstraint(
                condition=Q(refunded_amount_minor__lte=models.F("amount_minor")),
                name="payment_refund_not_over_amount",
            ),
            models.CheckConstraint(
                condition=Q(currency_exponent__lte=4), name="payment_currency_exponent_valid"
            ),
        ]
        indexes = [
            models.Index(
                fields=("account", "status", "-created_at"), name="payment_account_state_idx"
            ),
            models.Index(
                fields=("subscription", "status", "-created_at"),
                name="payment_subscription_state_idx",
            ),
            models.Index(fields=("status", "created_at"), name="payment_state_time_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.id}:{self.status}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.currency = self.currency.upper()
        super().save(*args, **kwargs)


class PaymentTransition(models.Model):
    class Source(models.TextChoices):
        SYSTEM = "system", "System"
        PROVIDER = "provider", "Verified provider event"
        REFUND = "refund", "Refund"
        RECONCILIATION = "reconciliation", "Reconciliation"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="transitions")
    from_status = models.CharField(max_length=24, choices=Payment.Status.choices, blank=True)
    to_status = models.CharField(max_length=24, choices=Payment.Status.choices)
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
                fields=("payment", "idempotency_key"), name="payment_transition_idempotent"
            )
        ]
        indexes = [
            models.Index(fields=("payment", "-effective_at"), name="payment_transition_time_idx"),
            models.Index(
                fields=("source", "source_reference"), name="payment_transition_source_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.payment_id}:{self.from_status}->{self.to_status}"

import uuid
from typing import Any

from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.product_catalog.models import Price
from apps.subscriptions.models import Subscription, SubscriptionAccount


class Payment(models.Model):
    class Method(models.TextChoices):
        PROVIDER = "provider", "Online provider"
        LIBYANA = "libyana", "Libyana recharge card"

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
    method = models.CharField(max_length=16, choices=Method.choices, default=Method.PROVIDER)
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


class ManualRechargeSubmission(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payment = models.OneToOneField(
        Payment, on_delete=models.PROTECT, related_name="manual_submission"
    )
    user = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="manual_payment_submissions"
    )
    recharge_code_ciphertext = models.TextField()
    recharge_code_digest = models.CharField(max_length=64, unique=True, editable=False)
    recharge_code_last4 = models.CharField(max_length=4, editable=False)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    submitted_at = models.DateTimeField(default=timezone.now, db_index=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="manual_payments_reviewed",
    )
    rejection_reason = models.CharField(max_length=500, blank=True)
    subscription_period_started_at = models.DateTimeField()
    subscription_period_ends_at = models.DateTimeField()
    previous_subscription_state = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-submitted_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("user",),
                condition=Q(status="pending"),
                name="manual_payment_one_pending_per_user",
            ),
            models.CheckConstraint(
                condition=Q(
                    subscription_period_ends_at__gt=models.F("subscription_period_started_at")
                ),
                name="manual_payment_period_valid",
            ),
        ]
        indexes = [
            models.Index(fields=("status", "submitted_at"), name="manual_payment_review_idx"),
            models.Index(fields=("user", "-submitted_at"), name="manual_payment_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.payment_id}:{self.status}:••••{self.recharge_code_last4}"


class PaymentTransition(models.Model):
    class Source(models.TextChoices):
        SYSTEM = "system", "System"
        PROVIDER = "provider", "Verified provider event"
        MANUAL_REVIEW = "manual_review", "Manual payment review"
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

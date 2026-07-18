import uuid
from typing import Any

from django.db import models
from django.db.models import Q

from apps.payments.models import Payment
from apps.subscriptions.models import Subscription, SubscriptionAccount


class Invoice(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        OPEN = "open", "Open"
        PAID = "paid", "Paid"
        VOID = "void", "Void"
        UNCOLLECTIBLE = "uncollectible", "Uncollectible"
        PARTIALLY_REFUNDED = "partially_refunded", "Partially refunded"
        REFUNDED = "refunded", "Refunded"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    number = models.CharField(max_length=32, unique=True)
    account = models.ForeignKey(
        SubscriptionAccount, on_delete=models.PROTECT, related_name="invoices"
    )
    subscription = models.ForeignKey(
        Subscription, on_delete=models.PROTECT, related_name="invoices"
    )
    payment = models.OneToOneField(Payment, on_delete=models.PROTECT, related_name="invoice")
    status = models.CharField(max_length=24, choices=Status.choices)
    currency = models.CharField(max_length=3)
    currency_exponent = models.PositiveSmallIntegerField(default=2)
    subtotal_minor = models.PositiveBigIntegerField()
    discount_minor = models.PositiveBigIntegerField(default=0)
    tax_minor = models.PositiveBigIntegerField(default=0)
    total_minor = models.PositiveBigIntegerField()
    amount_paid_minor = models.PositiveBigIntegerField(default=0)
    amount_refunded_minor = models.PositiveBigIntegerField(default=0)
    period_started_at = models.DateTimeField(null=True, blank=True)
    period_ends_at = models.DateTimeField(null=True, blank=True)
    issued_at = models.DateTimeField()
    due_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-issued_at", "-id")
        constraints = [
            models.CheckConstraint(condition=Q(total_minor__gt=0), name="invoice_total_positive"),
            models.CheckConstraint(
                condition=Q(amount_paid_minor__lte=models.F("total_minor")),
                name="invoice_paid_not_over_total",
            ),
            models.CheckConstraint(
                condition=Q(amount_refunded_minor__lte=models.F("amount_paid_minor")),
                name="invoice_refund_not_over_paid",
            ),
            models.CheckConstraint(
                condition=Q(currency_exponent__lte=4), name="invoice_currency_exponent_valid"
            ),
            models.CheckConstraint(
                condition=Q(period_ends_at__isnull=True)
                | Q(period_started_at__isnull=True)
                | Q(period_ends_at__gt=models.F("period_started_at")),
                name="invoice_period_window_valid",
            ),
        ]
        indexes = [
            models.Index(fields=("account", "-issued_at"), name="invoice_account_time_idx"),
            models.Index(fields=("status", "due_at"), name="invoice_state_due_idx"),
        ]

    def __str__(self) -> str:
        return self.number

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.currency = self.currency.upper()
        super().save(*args, **kwargs)


class InvoiceLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="lines")
    line_number = models.PositiveSmallIntegerField()
    description = models.CharField(max_length=240)
    quantity = models.PositiveIntegerField(default=1)
    unit_amount_minor = models.PositiveBigIntegerField()
    amount_minor = models.PositiveBigIntegerField()
    product_code = models.CharField(max_length=60)
    plan_code = models.CharField(max_length=60)
    price_code = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("line_number",)
        constraints = [
            models.UniqueConstraint(
                fields=("invoice", "line_number"), name="invoice_line_number_unique"
            ),
            models.CheckConstraint(
                condition=Q(quantity__gt=0), name="invoice_line_quantity_positive"
            ),
            models.CheckConstraint(
                condition=Q(unit_amount_minor__gt=0), name="invoice_line_unit_positive"
            ),
            models.CheckConstraint(
                condition=Q(amount_minor__gt=0), name="invoice_line_amount_positive"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.invoice.number}:{self.line_number}"


class InvoiceTransition(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="transitions")
    from_status = models.CharField(max_length=24, choices=Invoice.Status.choices, blank=True)
    to_status = models.CharField(max_length=24, choices=Invoice.Status.choices)
    reason_code = models.CharField(max_length=80)
    source_reference = models.CharField(max_length=180)
    effective_at = models.DateTimeField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("effective_at", "created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("invoice", "source_reference"), name="invoice_transition_source_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.invoice_id}:{self.to_status}"

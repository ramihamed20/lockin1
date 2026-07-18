import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.product_catalog.models import PlanVersion


class SubscriptionAccount(models.Model):
    class Kind(models.TextChoices):
        INDIVIDUAL = "individual", "Individual"
        FAMILY = "family", "Family (future)"
        ORGANIZATION = "organization", "Organization (future)"
        INSTITUTION = "institution", "Institution (future)"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"
        CLOSED = "closed", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    primary_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="subscription_accounts",
    )
    display_name = models.CharField(max_length=160)
    external_subject_id = models.UUIDField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("primary_user",),
                condition=Q(kind="individual", primary_user__isnull=False),
                name="subscription_individual_user_unique",
            ),
            models.CheckConstraint(
                condition=~Q(kind="individual") | Q(primary_user__isnull=False),
                name="subscription_individual_has_user",
            ),
        ]
        indexes = [models.Index(fields=("kind", "status"), name="subscription_account_kind_idx")]

    def __str__(self) -> str:
        return f"{self.kind}:{self.id}"


class Subscription(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending payment"
        TRIALING = "trialing", "Trial"
        ACTIVE = "active", "Active"
        GRACE = "grace", "Grace period"
        EXPIRED = "expired", "Expired"
        CANCELLED = "cancelled", "Cancelled"
        SUSPENDED = "suspended", "Suspended"
        REFUNDED = "refunded", "Refunded"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(
        SubscriptionAccount, on_delete=models.PROTECT, related_name="subscriptions"
    )
    plan_version = models.ForeignKey(
        PlanVersion, on_delete=models.PROTECT, related_name="subscriptions"
    )
    status = models.CharField(max_length=12, choices=Status.choices)
    started_at = models.DateTimeField(null=True, blank=True)
    trial_started_at = models.DateTimeField(null=True, blank=True)
    trial_ends_at = models.DateTimeField(null=True, blank=True)
    current_period_started_at = models.DateTimeField(null=True, blank=True)
    current_period_ends_at = models.DateTimeField(null=True, blank=True)
    grace_ends_at = models.DateTimeField(null=True, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)
    cancellation_requested_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    suspended_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    status_reason = models.CharField(max_length=80, blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("account",),
                condition=Q(status__in=("trialing", "active", "grace", "suspended")),
                name="subscription_one_live_per_account",
            ),
            models.UniqueConstraint(
                fields=("account",),
                condition=Q(status="pending"),
                name="subscription_one_pending_per_account",
            ),
            models.CheckConstraint(
                condition=Q(trial_ends_at__isnull=True)
                | Q(trial_started_at__isnull=True)
                | Q(trial_ends_at__gt=models.F("trial_started_at")),
                name="subscription_trial_window_valid",
            ),
            models.CheckConstraint(
                condition=Q(current_period_ends_at__isnull=True)
                | Q(current_period_started_at__isnull=True)
                | Q(current_period_ends_at__gt=models.F("current_period_started_at")),
                name="subscription_period_window_valid",
            ),
        ]
        indexes = [
            models.Index(
                fields=("account", "status", "-created_at"), name="subscription_account_state_idx"
            ),
            models.Index(
                fields=("status", "current_period_ends_at"), name="subscription_period_due_idx"
            ),
            models.Index(fields=("status", "trial_ends_at"), name="subscription_trial_due_idx"),
            models.Index(fields=("status", "grace_ends_at"), name="subscription_grace_due_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.account_id}:{self.status}"


class SubscriptionTransition(models.Model):
    class Source(models.TextChoices):
        SYSTEM = "system", "System"
        USER = "user", "User request"
        ADMIN = "admin", "Administrator"
        PROVIDER = "provider", "Verified provider event"
        RECONCILIATION = "reconciliation", "Reconciliation"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subscription = models.ForeignKey(
        Subscription, on_delete=models.PROTECT, related_name="transitions"
    )
    from_status = models.CharField(max_length=12, choices=Subscription.Status.choices, blank=True)
    to_status = models.CharField(max_length=12, choices=Subscription.Status.choices)
    source = models.CharField(max_length=16, choices=Source.choices)
    reason_code = models.CharField(max_length=80)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="subscription_transitions_made",
    )
    source_reference = models.CharField(max_length=160, blank=True)
    idempotency_key = models.CharField(max_length=180, blank=True)
    effective_at = models.DateTimeField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("effective_at", "created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("subscription", "idempotency_key"),
                condition=~Q(idempotency_key=""),
                name="subscription_transition_idempotent",
            )
        ]
        indexes = [
            models.Index(fields=("subscription", "-effective_at"), name="sub_transition_time_idx"),
            models.Index(fields=("source", "source_reference"), name="subscription_source_ref_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.subscription_id}:{self.from_status}->{self.to_status}"

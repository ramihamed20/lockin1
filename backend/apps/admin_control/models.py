import uuid
from typing import Any

from django.conf import settings
from django.db import models


class AppendOnlyQuerySet(models.QuerySet[models.Model]):
    def update(self, **kwargs: Any) -> int:
        raise TypeError("Administrative history is append-only.")

    def delete(self) -> tuple[int, dict[str, int]]:
        raise TypeError("Administrative history is append-only.")


class AdminInternalNote(models.Model):
    """An append-only private note attached to an operational target."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    target_type = models.CharField(max_length=80)
    target_id = models.CharField(max_length=100)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="administrative_notes",
    )
    body = models.TextField(max_length=4000)
    created_at = models.DateTimeField(auto_now_add=True)
    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(
                fields=("target_type", "target_id", "-created_at"),
                name="admin_note_target_time_idx",
            ),
            models.Index(fields=("author", "-created_at"), name="admin_note_author_time_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.target_type}:{self.target_id}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self._state.adding:
            raise TypeError("Administrative notes are append-only.")
        super().save(*args, **kwargs)


class SubscriptionAdminEvent(models.Model):
    """Immutable history for manual subscription and access changes."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subscription = models.ForeignKey(
        "subscriptions.Subscription",
        on_delete=models.PROTECT,
        related_name="admin_events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="subscription_admin_events",
    )
    action = models.CharField(max_length=60)
    idempotency_key = models.CharField(max_length=180)
    reason = models.CharField(max_length=500)
    note = models.TextField(max_length=4000, blank=True)
    previous_state = models.JSONField(default=dict, blank=True)
    new_state = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=("subscription", "-created_at"), name="admin_sub_event_time_idx")
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("subscription", "idempotency_key"),
                name="admin_sub_event_idempotent",
            )
        ]

    def __str__(self) -> str:
        return f"{self.subscription_id}:{self.action}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self._state.adding:
            raise TypeError("Subscription administration history is immutable.")
        super().save(*args, **kwargs)


class PaymentStatusCorrection(models.Model):
    """Dual-control reconciliation request; never a direct status override."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payment = models.ForeignKey(
        "payments.Payment", on_delete=models.PROTECT, related_name="admin_corrections"
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="payment_corrections_requested",
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="payment_corrections_reviewed",
        null=True,
        blank=True,
    )
    requested_status = models.CharField(max_length=24)
    provider_reference = models.CharField(max_length=180)
    reason = models.CharField(max_length=500)
    review_reason = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    idempotency_key = models.CharField(max_length=180)
    approval_idempotency_key = models.CharField(max_length=180, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("payment", "requested_by", "idempotency_key"),
                name="admin_payment_correction_idempotent",
            )
        ]
        indexes = [
            models.Index(
                fields=("payment", "status", "-created_at"), name="admin_payment_correct_idx"
            ),
            models.Index(fields=("status", "-created_at"), name="admin_correction_state_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.payment_id}:{self.requested_status}:{self.status}"


class NotificationCampaign(models.Model):
    class Audience(models.TextChoices):
        USER = "user", "One user"
        SELECTED_USERS = "selected_users", "Selected users"
        ALL_USERS = "all_users", "All users"
        ACTIVE_SUBSCRIBERS = "active_subscribers", "Active subscribers"
        EXPIRED_SUBSCRIBERS = "expired_subscribers", "Expired subscribers"
        TRIAL_USERS = "trial_users", "Trial users"
        CREATORS = "creators", "Creators"
        PLAN_USERS = "plan_users", "Users on a plan"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SCHEDULED = "scheduled", "Scheduled"
        PROCESSING = "processing", "Processing"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    audience = models.CharField(max_length=24, choices=Audience.choices)
    audience_filter = models.JSONField(default=dict, blank=True)
    title = models.CharField(max_length=160)
    body = models.CharField(max_length=320)
    send_in_app = models.BooleanField(default=True)
    send_email = models.BooleanField(default=False)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    scheduled_for = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="notification_campaigns_created",
    )
    reason = models.CharField(max_length=500)
    delivered_count = models.PositiveIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=("status", "scheduled_for"), name="admin_campaign_due_idx"),
            models.Index(fields=("created_by", "-created_at"), name="admin_campaign_creator_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.title}:{self.status}"


class NotificationCampaignDelivery(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(
        NotificationCampaign, on_delete=models.PROTECT, related_name="deliveries"
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="campaign_deliveries",
    )
    in_app_notification = models.ForeignKey(
        "notifications.Notification",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="campaign_delivery_records",
    )
    in_app_status = models.CharField(max_length=12, default="not_requested")
    email_status = models.CharField(max_length=12, default="not_requested")
    failure_reason = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("campaign", "recipient"), name="admin_campaign_recipient_unique"
            )
        ]
        indexes = [
            models.Index(fields=("campaign", "in_app_status"), name="admin_campaign_inapp_idx"),
            models.Index(fields=("campaign", "email_status"), name="admin_campaign_email_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.campaign_id}:{self.recipient_id}"

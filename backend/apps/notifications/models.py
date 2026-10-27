import uuid
from datetime import time

from django.conf import settings
from django.db import models
from django.utils import timezone


class Notification(models.Model):
    class Category(models.TextChoices):
        ACCOUNT = "account", "Account"
        LEARNING = "learning", "Learning"
        ACHIEVEMENT = "achievement", "Achievement"
        COMMUNITY = "community", "Community"
        MODERATION = "moderation", "Moderation"
        PLATFORM = "platform", "Platform"
        BILLING = "billing", "Billing"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_notifications",
    )
    category = models.CharField(max_length=20, choices=Category.choices)
    template_key = models.CharField(max_length=80)
    title = models.CharField(max_length=160)
    body = models.CharField(max_length=320)
    data = models.JSONField(default=dict, blank=True)
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.UUIDField(null=True, blank=True)
    target_route = models.CharField(max_length=300, blank=True)
    is_required = models.BooleanField(default=False)
    deduplication_key = models.CharField(max_length=220)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("recipient", "deduplication_key"),
                name="notification_recipient_dedup_unique",
            )
        ]
        indexes = [
            models.Index(
                fields=("recipient", "read_at", "-created_at"), name="notify_user_unread_idx"
            ),
            models.Index(
                fields=("recipient", "category", "-created_at"), name="notify_user_category_idx"
            ),
            models.Index(fields=("target_type", "target_id"), name="notify_target_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.recipient_id}:{self.template_key}"


class NotificationPreference(models.Model):
    class Channel(models.TextChoices):
        IN_APP = "in_app", "In app"
        EMAIL = "email", "Email (future)"
        PUSH = "push", "Push"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_preferences",
    )
    category = models.CharField(max_length=20, choices=Notification.Category.choices)
    channel = models.CharField(max_length=12, choices=Channel.choices)
    enabled = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "category", "channel"), name="notification_preference_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.category}:{self.channel}"


class NotificationCounter(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="notification_counter",
    )
    unread_count = models.PositiveBigIntegerField(default=0)
    revision = models.PositiveBigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.user_id}:{self.unread_count}"


class StudyReminder(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        primary_key=True,
        on_delete=models.CASCADE,
        related_name="study_reminder",
    )
    enabled = models.BooleanField(default=False)
    time = models.TimeField(default=time(18, 0))
    timezone = models.CharField(max_length=64, default="Africa/Tripoli")
    locale = models.CharField(
        max_length=2, choices=(("ar", "Arabic"), ("en", "English")), default="ar"
    )
    revision = models.PositiveIntegerField(default=1)
    next_due_at = models.DateTimeField(null=True, blank=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.user_id}:{self.timezone}:{self.time}"


class NotificationDelivery(models.Model):
    """In-app delivery summary; Web Push tracks each installation separately."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        DELIVERED = "delivered", "Delivered"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    notification = models.ForeignKey(
        Notification, on_delete=models.CASCADE, related_name="deliveries"
    )
    channel = models.CharField(max_length=12, choices=NotificationPreference.Channel.choices)
    status = models.CharField(max_length=12, choices=Status.choices)
    provider_reference = models.CharField(max_length=160, blank=True)
    failure_reason = models.CharField(max_length=240, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("notification", "channel"), name="notification_delivery_unique"
            )
        ]
        indexes = [
            models.Index(
                fields=("channel", "status", "created_at"), name="notify_delivery_state_idx"
            )
        ]

    def __str__(self) -> str:
        return f"{self.notification_id}:{self.channel}:{self.status}"


class PushSubscription(models.Model):
    """One browser installation, owned by its current authenticated session."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account_session = models.ForeignKey(
        "accounts.AccountSession", on_delete=models.CASCADE, related_name="push_subscriptions"
    )
    endpoint_hash = models.CharField(max_length=64, unique=True)
    subscription = models.JSONField()
    binding = models.UUIDField(default=uuid.uuid4)
    locale = models.CharField(max_length=2, default="ar")
    active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Web Push installation {self.id}"


class PushDelivery(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENDING = "sending", "Sending"
        ACCEPTED = "accepted", "Accepted by push service"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    notification = models.ForeignKey(Notification, on_delete=models.CASCADE)
    subscription = models.ForeignKey(PushSubscription, on_delete=models.CASCADE)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField(default=timezone.now)
    locked_until = models.DateTimeField(null=True, blank=True)
    lock_token = models.UUIDField(null=True, blank=True)
    error_code = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("notification", "subscription"), name="push_delivery_unique"
            )
        ]
        indexes = [models.Index(fields=("status", "next_attempt_at"), name="push_delivery_due_idx")]

    def __str__(self) -> str:
        return f"{self.notification_id}:{self.status}"

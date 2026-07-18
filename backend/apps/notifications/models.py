import uuid

from django.conf import settings
from django.db import models


class Notification(models.Model):
    class Category(models.TextChoices):
        ACCOUNT = "account", "Account"
        LEARNING = "learning", "Learning"
        ACHIEVEMENT = "achievement", "Achievement"
        COMMUNITY = "community", "Community"
        MODERATION = "moderation", "Moderation"
        PLATFORM = "platform", "Platform"

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
        PUSH = "push", "Push (future)"

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


class NotificationDelivery(models.Model):
    """Channel-neutral delivery state; only in-app is implemented in this phase."""

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

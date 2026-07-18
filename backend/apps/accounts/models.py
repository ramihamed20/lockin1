import uuid
from typing import Any

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone

from .managers import UserManager


class User(AbstractBaseUser, PermissionsMixin):
    class Language(models.TextChoices):
        ENGLISH = "en", "English"
        ARABIC = "ar", "Arabic"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"
        DELETED = "deleted", "Deleted"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, max_length=254)
    full_name = models.CharField(max_length=150)
    preferred_language = models.CharField(
        max_length=2, choices=Language.choices, default=Language.ENGLISH
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    policy_accepted_at = models.DateTimeField(null=True, blank=True)
    policy_version = models.CharField(max_length=64, blank=True)
    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    date_joined = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]
    EMAIL_FIELD = "email"

    class Meta:
        ordering = ("-date_joined",)
        constraints = [
            models.UniqueConstraint(Lower("email"), name="accounts_user_email_ci_unique"),
        ]

    def clean(self) -> None:
        super().clean()
        self.email = self.__class__.objects.normalize_email(self.email).strip().lower()
        self.full_name = self.full_name.strip()
        self.is_active = self.status == self.Status.ACTIVE

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.email = self.__class__.objects.normalize_email(self.email).strip().lower()
        self.full_name = self.full_name.strip()
        self.is_active = self.status == self.Status.ACTIVE
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.email

    @property
    def is_email_verified(self) -> bool:
        return self.email_verified_at is not None


class OneTimeToken(models.Model):
    class Kind(models.TextChoices):
        EMAIL_VERIFICATION = "email_verification", "Email verification"
        PASSWORD_RESET = "password_reset", "Password reset"
        EMAIL_CHANGE = "email_change", "Email change"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="one_time_tokens")
    kind = models.CharField(max_length=24, choices=Kind.choices)
    token_digest = models.CharField(max_length=64, unique=True, editable=False)
    payload = models.JSONField(default=dict, blank=True)
    expires_at = models.DateTimeField(db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=("user", "kind", "used_at"))]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(used_at__isnull=True)
                | models.Q(used_at__gte=models.F("created_at")),
                name="accounts_token_used_after_created",
            )
        ]

    def __str__(self) -> str:
        return f"{self.kind} token for {self.user_id}"

    @property
    def is_usable(self) -> bool:
        return self.used_at is None and self.expires_at > timezone.now()


class AccountSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="account_sessions")
    session_key = models.CharField(max_length=40, unique=True)
    device_label = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(db_index=True)

    class Meta:
        ordering = ("-last_seen_at",)
        indexes = [models.Index(fields=("user", "expires_at"))]

    def __str__(self) -> str:
        return f"{self.device_label} session for {self.user_id}"


class AuthAttempt(models.Model):
    scope = models.CharField(max_length=32)
    key_hash = models.CharField(max_length=64)
    attempted_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        indexes = [models.Index(fields=("scope", "key_hash", "attempted_at"))]

    def __str__(self) -> str:
        return f"{self.scope} attempt at {self.attempted_at.isoformat()}"


class AccountSecurityEvent(models.Model):
    class EventType(models.TextChoices):
        REGISTERED = "registered", "Registered"
        EMAIL_VERIFIED = "email_verified", "Email verified"
        EMAIL_CHANGED = "email_changed", "Email changed"
        PASSWORD_CHANGED = "password_changed", "Password changed"
        PASSWORD_RESET = "password_reset", "Password reset"
        LOGIN_SUCCEEDED = "login_succeeded", "Login succeeded"
        LOGOUT = "logout", "Logout"
        ROLE_CHANGED = "role_changed", "Role changed"
        STATUS_CHANGED = "status_changed", "Status changed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="security_events")
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="account_security_actions",
    )
    event_type = models.CharField(max_length=24, choices=EventType.choices)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.event_type} for {self.user_id}"

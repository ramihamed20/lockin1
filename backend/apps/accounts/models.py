import uuid
from typing import Any

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.core.validators import RegexValidator
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

    class AvatarDefault(models.TextChoices):
        MALE_GRAYBLUE = "cat-male-grayblue", "Gray-blue cat"
        FEMALE_CALICO = "cat-female-calico", "Calico cat"
        MALE_ORANGE = "cat-male-orange", "Orange cat"
        MALE_TUXEDO = "cat-male-tuxedo", "Tuxedo cat"
        FEMALE_LAVENDER = "cat-female-lavender", "Lavender cat"
        FEMALE_PINK = "cat-female-pink", "Pink cat"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, max_length=254)
    username = models.CharField(
        max_length=30,
        null=True,
        blank=True,
        validators=[
            RegexValidator(
                regex=r"^[a-z0-9][a-z0-9_]{2,29}$",
                message=(
                    "Use 3–30 lowercase letters, numbers, or underscores, "
                    "starting with a letter or number."
                ),
            )
        ],
    )
    full_name = models.CharField(max_length=150, blank=True)
    preferred_language = models.CharField(
        max_length=2, choices=Language.choices, default=Language.ENGLISH
    )
    cohort = models.ForeignKey(
        "education.StudentCohort",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="students",
    )
    profile_completion_required = models.BooleanField(default=False)
    welcome_completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    policy_accepted_at = models.DateTimeField(null=True, blank=True)
    policy_version = models.CharField(max_length=64, blank=True)
    avatar_default = models.CharField(max_length=32, choices=AvatarDefault.choices, blank=True)
    profile_image = models.ForeignKey(
        "files.ManagedFile",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="profile_image_users",
    )
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
            models.UniqueConstraint(
                Lower("username"),
                condition=models.Q(username__isnull=False),
                name="accounts_user_username_ci_unique",
            ),
        ]

    def clean(self) -> None:
        super().clean()
        self.email = self.__class__.objects.normalize_email(self.email).strip().lower()
        self.username = self.username.strip().lower() if self.username else None
        self.full_name = self.full_name.strip()
        self.is_active = self.status == self.Status.ACTIVE

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.email = self.__class__.objects.normalize_email(self.email).strip().lower()
        self.username = self.username.strip().lower() if self.username else None
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
        ACCOUNT_DELETION = "account_deletion", "Account deletion"

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
        SOCIAL_IDENTITY_LINKED = "social_identity_linked", "Social identity linked"
        SOCIAL_LOGIN_SUCCEEDED = "social_login_succeeded", "Social login succeeded"
        LOGOUT = "logout", "Logout"
        ROLE_CHANGED = "role_changed", "Role changed"
        STATUS_CHANGED = "status_changed", "Status changed"
        DELETION_REQUESTED = "deletion_requested", "Deletion requested"
        DELETION_CONFIRMED = "deletion_confirmed", "Deletion confirmed"
        DELETION_CANCELLED = "deletion_cancelled", "Deletion cancelled"

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


class SocialIdentity(models.Model):
    class Provider(models.TextChoices):
        GOOGLE = "google", "Google"
        APPLE = "apple", "Apple"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="social_identities")
    provider = models.CharField(max_length=16, choices=Provider.choices)
    subject = models.CharField(max_length=255)
    provider_email = models.EmailField(max_length=254, blank=True)
    email_verified = models.BooleanField(default=False)
    is_private_relay = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ("provider", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=("provider", "subject"),
                name="accounts_social_provider_subject_unique",
            ),
            models.UniqueConstraint(
                fields=("user", "provider"),
                name="accounts_social_user_provider_unique",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.provider}:{self.subject}"


class OAuthFlow(models.Model):
    class Intent(models.TextChoices):
        LOGIN = "login", "Login"
        REGISTER = "register", "Register"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.CharField(max_length=16, choices=SocialIdentity.Provider.choices)
    intent = models.CharField(max_length=16, choices=Intent.choices)
    state_digest = models.CharField(max_length=64, editable=False)
    nonce_digest = models.CharField(max_length=64, editable=False)
    browser_binding_digest = models.CharField(max_length=64, editable=False)
    preferred_language = models.CharField(
        max_length=2,
        choices=User.Language.choices,
        default=User.Language.ENGLISH,
    )
    remember_me = models.BooleanField(default=True)
    policy_accepted = models.BooleanField(default=False)
    policy_version = models.CharField(max_length=64, blank=True)
    expires_at = models.DateTimeField(db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=("provider", "expires_at", "used_at"),
                name="accounts_oauth_flow_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.provider} OAuth flow {self.id}"

    @property
    def is_usable(self) -> bool:
        return self.used_at is None and self.expires_at > timezone.now()


class AccountDeletionRequest(models.Model):
    """Verified deletion request; processing waits for an approved retention policy."""

    class Status(models.TextChoices):
        PENDING_CONFIRMATION = "pending_confirmation", "Pending confirmation"
        CONFIRMED = "confirmed", "Confirmed"
        PROCESSING = "processing", "Processing"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="deletion_requests",
    )
    confirmation_token = models.OneToOneField(
        OneTimeToken,
        on_delete=models.PROTECT,
        related_name="account_deletion_request",
    )
    status = models.CharField(
        max_length=24,
        choices=Status.choices,
        default=Status.PENDING_CONFIRMATION,
    )
    policy_version = models.CharField(max_length=80, blank=True)
    requested_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    processing_started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-requested_at", "-id")
        indexes = [
            models.Index(fields=("status", "requested_at"), name="account_delete_state_idx"),
            models.Index(fields=("user", "status"), name="account_delete_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.status}"

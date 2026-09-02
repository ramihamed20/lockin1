from typing import Any

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models.functions import Lower
from rest_framework import serializers

from apps.education.models import StudentCohort
from apps.education.serializers import StudentCohortSerializer
from platform_core.api.serializers import StrictSerializer

from .avatars import AvatarPayload, avatar_payload
from .models import AccountSession, User
from .roles import MANAGED_ROLES, Role, get_user_roles
from .services import normalize_email


def validate_username(value: str, *, user: User | None = None) -> str:
    username = value.strip().lower()
    if not 3 <= len(username) <= 30:
        raise serializers.ValidationError("Use a username between 3 and 30 characters.")
    if not username[0].isalnum() or any(
        not (character.isascii() and (character.isalnum() or character == "_"))
        for character in username
    ):
        raise serializers.ValidationError(
            "Use lowercase English letters, numbers, or underscores, "
            "starting with a letter or number."
        )
    query = User.objects.annotate(username_lower=Lower("username")).filter(username_lower=username)
    if user is not None:
        query = query.exclude(id=user.id)
    if query.exists():
        raise serializers.ValidationError("That username is unavailable.", code="unavailable")
    return username


def _validate_new_password(password: str, *, user: User | None = None) -> str:
    try:
        validate_password(password, user=user)
    except DjangoValidationError as error:
        raise serializers.ValidationError(list(error.messages)) from error
    return password


class RegistrationSerializer(StrictSerializer):
    username = serializers.CharField(
        min_length=3, max_length=30, trim_whitespace=True, required=False
    )
    full_name = serializers.CharField(max_length=150, trim_whitespace=True)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    password_confirm = serializers.CharField(write_only=True, trim_whitespace=False)
    preferred_language = serializers.ChoiceField(choices=User.Language.choices)
    cohort_id = serializers.PrimaryKeyRelatedField(
        queryset=StudentCohort.objects.filter(is_active=True),
        source="cohort",
    )
    accept_policies = serializers.BooleanField(write_only=True)

    def validate_email(self, value: str) -> str:
        return normalize_email(value)

    def validate_username(self, value: str) -> str:
        return validate_username(value)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": ["Passwords do not match."]})
        if attrs["accept_policies"] is not True:
            raise serializers.ValidationError(
                {"accept_policies": ["Policy acceptance is required."]}
            )
        attrs["password"] = _validate_new_password(str(attrs["password"]))
        return attrs


class EmailSerializer(StrictSerializer):
    email = serializers.EmailField(max_length=254)

    def validate_email(self, value: str) -> str:
        return normalize_email(value)


class TokenSerializer(StrictSerializer):
    token = serializers.CharField(max_length=256, trim_whitespace=True)


class PasswordResetConfirmSerializer(TokenSerializer):
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password_confirm = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if attrs["new_password"] != attrs["new_password_confirm"]:
            raise serializers.ValidationError({"new_password_confirm": ["Passwords do not match."]})
        attrs["new_password"] = _validate_new_password(str(attrs["new_password"]))
        return attrs


class LoginSerializer(StrictSerializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    remember_me = serializers.BooleanField(default=False)

    def validate_email(self, value: str) -> str:
        return normalize_email(value)


class OAuthStartSerializer(StrictSerializer):
    intent = serializers.ChoiceField(choices=("login", "register"), default="login")
    preferred_language = serializers.ChoiceField(choices=User.Language.choices, default="en")
    remember_me = serializers.BooleanField(default=True)
    accept_policies = serializers.BooleanField(default=False)


class UserSerializer(serializers.ModelSerializer[User]):
    roles = serializers.SerializerMethodField()
    is_email_verified = serializers.BooleanField(read_only=True)
    cohort = StudentCohortSerializer(read_only=True)
    onboarding_required = serializers.SerializerMethodField()
    required_profile_fields = serializers.SerializerMethodField()
    username_required = serializers.SerializerMethodField()
    welcome_required = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "username",
            "full_name",
            "preferred_language",
            "cohort",
            "status",
            "is_email_verified",
            "onboarding_required",
            "required_profile_fields",
            "username_required",
            "welcome_required",
            "welcome_completed_at",
            "avatar",
            "roles",
            "date_joined",
        )
        read_only_fields = fields

    def get_roles(self, user: User) -> tuple[str, ...]:
        return get_user_roles(user)

    def get_required_profile_fields(self, user: User) -> tuple[str, ...]:
        if not user.profile_completion_required:
            return ()
        fields: list[str] = []
        if not user.full_name.strip():
            fields.append("full_name")
        if user.cohort_id is None:
            fields.append("cohort")
        return tuple(fields)

    def get_username_required(self, user: User) -> bool:
        return not bool(user.username)

    def get_welcome_required(self, user: User) -> bool:
        return user.welcome_completed_at is None

    def get_onboarding_required(self, user: User) -> bool:
        return self.get_username_required(user) or bool(self.get_required_profile_fields(user))

    def get_avatar(self, user: User) -> AvatarPayload:
        return avatar_payload(user)


class ProfileUpdateSerializer(StrictSerializer):
    username = serializers.CharField(
        min_length=3, max_length=30, trim_whitespace=True, required=False
    )
    full_name = serializers.CharField(max_length=150, trim_whitespace=True, required=False)
    preferred_language = serializers.ChoiceField(choices=User.Language.choices, required=False)
    avatar_default = serializers.ChoiceField(choices=User.AvatarDefault.choices, required=False)
    cohort_id = serializers.PrimaryKeyRelatedField(
        queryset=StudentCohort.objects.filter(is_active=True),
        source="cohort",
        required=False,
    )

    def validate_username(self, value: str) -> str:
        user = self.context.get("user")
        return validate_username(value, user=user if isinstance(user, User) else None)


class ProfileAvatarUploadSerializer(StrictSerializer):
    file = serializers.FileField(write_only=True)


class PasswordChangeSerializer(StrictSerializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password_confirm = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        user = self.context.get("user")
        if not isinstance(user, User) or not user.check_password(str(attrs["current_password"])):
            raise serializers.ValidationError(
                {"current_password": ["The current password is incorrect."]}
            )
        if attrs["new_password"] != attrs["new_password_confirm"]:
            raise serializers.ValidationError({"new_password_confirm": ["Passwords do not match."]})
        attrs["new_password"] = _validate_new_password(str(attrs["new_password"]), user=user)
        return attrs


class EmailChangeRequestSerializer(StrictSerializer):
    new_email = serializers.EmailField(max_length=254)
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        user = self.context.get("user")
        if not isinstance(user, User) or not user.check_password(str(attrs["current_password"])):
            raise serializers.ValidationError(
                {"current_password": ["The current password is incorrect."]}
            )
        attrs["new_email"] = normalize_email(str(attrs["new_email"]))
        if attrs["new_email"] == user.email:
            raise serializers.ValidationError(
                {"new_email": ["Enter an email address different from the current one."]}
            )
        return attrs


class AccountDeletionPasswordSerializer(StrictSerializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_current_password(self, value: str) -> str:
        user = self.context.get("user")
        if not isinstance(user, User) or not user.check_password(value):
            raise serializers.ValidationError("The current password is incorrect.")
        return value


class AccountSessionSerializer(serializers.ModelSerializer[AccountSession]):
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = AccountSession
        fields = ("id", "device_label", "created_at", "last_seen_at", "expires_at", "is_current")
        read_only_fields = fields

    def get_is_current(self, session: AccountSession) -> bool:
        return session.session_key == self.context.get("current_session_key")


class RoleUpdateSerializer(StrictSerializer):
    roles = serializers.ListField(
        child=serializers.ChoiceField(choices=[role.value for role in MANAGED_ROLES]),
        allow_empty=True,
    )

    def validate_roles(self, value: list[str]) -> set[Role]:
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Roles cannot be duplicated.")
        return {Role(role) for role in value}

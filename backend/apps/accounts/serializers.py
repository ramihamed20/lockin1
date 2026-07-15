from collections.abc import Mapping
from typing import Any, cast

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import AccountSession, User
from .roles import MANAGED_ROLES, Role, get_user_roles
from .services import normalize_email


class StrictSerializer(serializers.Serializer[Any]):
    def to_internal_value(self, data: Any) -> dict[str, Any]:
        if isinstance(data, Mapping):
            allowed = set(self.fields)
            unknown = sorted(set(data) - allowed)
            if unknown:
                raise serializers.ValidationError(
                    {"non_field_errors": [f"Unknown field: {name}" for name in unknown]}
                )
        return cast(dict[str, Any], super().to_internal_value(data))


def _validate_new_password(password: str, *, user: User | None = None) -> str:
    try:
        validate_password(password, user=user)
    except DjangoValidationError as error:
        raise serializers.ValidationError(list(error.messages)) from error
    return password


class RegistrationSerializer(StrictSerializer):
    full_name = serializers.CharField(max_length=150, trim_whitespace=True)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    password_confirm = serializers.CharField(write_only=True, trim_whitespace=False)
    preferred_language = serializers.ChoiceField(choices=User.Language.choices)
    accept_policies = serializers.BooleanField(write_only=True)

    def validate_email(self, value: str) -> str:
        normalized = normalize_email(value)
        if User.objects.filter(email=normalized).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return normalized

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


class UserSerializer(serializers.ModelSerializer[User]):
    roles = serializers.SerializerMethodField()
    is_email_verified = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "full_name",
            "preferred_language",
            "status",
            "is_email_verified",
            "roles",
            "date_joined",
        )
        read_only_fields = fields

    def get_roles(self, user: User) -> tuple[str, ...]:
        return get_user_roles(user)


class ProfileUpdateSerializer(StrictSerializer):
    full_name = serializers.CharField(max_length=150, trim_whitespace=True, required=False)
    preferred_language = serializers.ChoiceField(choices=User.Language.choices, required=False)


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

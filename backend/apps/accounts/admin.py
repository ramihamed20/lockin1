from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import AccountSecurityEvent, AccountSession, OneTimeToken, User


@admin.register(User)
class LockinUserAdmin(UserAdmin):  # type: ignore[type-arg]
    model = User
    ordering = ("email",)
    list_display = ("email", "full_name", "status", "is_staff", "is_active")
    list_filter = ("status", "is_staff", "is_active", "preferred_language")
    search_fields = ("email", "full_name")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        (
            "Profile",
            {
                "fields": (
                    "full_name",
                    "preferred_language",
                    "status",
                    "email_verified_at",
                    "policy_accepted_at",
                    "policy_version",
                )
            },
        ),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Dates", {"fields": ("last_login", "date_joined", "updated_at")}),
    )
    readonly_fields = ("date_joined", "updated_at", "last_login", "is_active")
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "full_name", "password1", "password2", "is_staff"),
            },
        ),
    )


@admin.register(AccountSession)
class AccountSessionAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("user", "device_label", "last_seen_at", "expires_at")
    search_fields = ("user__email", "device_label")
    exclude = ("session_key",)
    readonly_fields = ("created_at", "last_seen_at", "expires_at")


@admin.register(AccountSecurityEvent)
class AccountSecurityEventAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("event_type", "user", "actor", "created_at")
    list_filter = ("event_type",)
    search_fields = ("user__email", "actor__email")
    readonly_fields = ("user", "actor", "event_type", "metadata", "created_at")

    def has_add_permission(self, request):  # type: ignore[no-untyped-def]
        return False

    def has_change_permission(self, request, obj=None):  # type: ignore[no-untyped-def]
        return False

    def has_delete_permission(self, request, obj=None):  # type: ignore[no-untyped-def]
        return False


@admin.register(OneTimeToken)
class OneTimeTokenAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("kind", "user", "created_at", "expires_at", "used_at")
    list_filter = ("kind",)
    search_fields = ("user__email",)
    readonly_fields = (
        "user",
        "kind",
        "token_digest",
        "payload",
        "created_at",
        "expires_at",
        "used_at",
    )

    def has_add_permission(self, request):  # type: ignore[no-untyped-def]
        return False

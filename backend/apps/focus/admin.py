from django.contrib import admin

from .models import FocusSession, FocusSessionActivity


class FocusSessionActivityInline(admin.TabularInline):  # type: ignore[type-arg]
    model = FocusSessionActivity
    extra = 0
    can_delete = False
    readonly_fields = ("sequence", "activity_type", "occurred_at", "metadata")

    def has_add_permission(self, request: object, obj: object | None = None) -> bool:
        return False


@admin.register(FocusSession)
class FocusSessionAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "user", "context_type", "status", "started_at", "ended_at")
    list_filter = ("context_type", "status")
    search_fields = ("user__email",)
    readonly_fields = ("created_at", "updated_at")
    inlines = (FocusSessionActivityInline,)

from django.contrib import admin
from django.http import HttpRequest

from .models import ScheduledJobState


@admin.register(ScheduledJobState)
class ScheduledJobStateAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = (
        "code",
        "status",
        "next_run_at",
        "last_succeeded_at",
        "last_failed_at",
        "failure_count",
    )
    list_filter = ("status",)
    search_fields = ("code", "last_error_code")
    readonly_fields = (
        "code",
        "status",
        "claim_token",
        "next_run_at",
        "last_started_at",
        "last_succeeded_at",
        "last_failed_at",
        "last_duration_ms",
        "run_count",
        "failure_count",
        "last_error_code",
        "updated_at",
    )

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return False

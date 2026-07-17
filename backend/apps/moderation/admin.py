from django.contrib import admin
from django.http import HttpRequest

from .models import ModerationAuditEntry, ModerationRateBucket, Report


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("target_type", "target_label", "reason", "status", "priority", "created_at")
    list_filter = ("target_type", "reason", "status", "priority")
    search_fields = ("target_label", "description", "reporter__email")
    readonly_fields = (
        "id",
        "reporter",
        "target_type",
        "target_id",
        "target_version_id",
        "target_author_id",
        "target_label",
        "context_type",
        "context_id",
        "private_space_id",
        "reason",
        "description",
        "evidence_snapshot",
        "status",
        "priority",
        "assigned_to",
        "duplicate_of",
        "resolution_notes",
        "revision",
        "client_request_id",
        "resolved_at",
        "created_at",
        "updated_at",
    )

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return False


@admin.register(ModerationAuditEntry)
class ModerationAuditEntryAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("action", "target_type", "target_id", "actor", "created_at")
    readonly_fields = (
        "id",
        "report",
        "actor",
        "action",
        "target_type",
        "target_id",
        "reason",
        "metadata",
        "created_at",
    )

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return False


admin.site.register(ModerationRateBucket)

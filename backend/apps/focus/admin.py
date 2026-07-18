from django.contrib import admin

from .models import (
    FocusAnnotation,
    FocusAnnotationCollection,
    FocusSession,
    FocusSessionActivity,
    FocusSyncReceipt,
    FocusWorkspaceSnapshot,
)


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


@admin.register(FocusWorkspaceSnapshot)
class FocusWorkspaceSnapshotAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "user", "document_version_id", "current_page", "revision", "updated_at")
    search_fields = ("user__email", "document_version_id", "session__id")
    readonly_fields = (
        "session",
        "user",
        "document_id",
        "document_version_id",
        "file_id",
        "current_page",
        "page_count",
        "zoom",
        "sidebar",
        "active_tool",
        "layout",
        "open_tabs",
        "revision",
        "created_at",
        "updated_at",
    )

    def has_add_permission(self, request: object) -> bool:
        return False

    def has_delete_permission(self, request: object, obj: object | None = None) -> bool:
        return False


@admin.register(FocusAnnotationCollection)
class FocusAnnotationCollectionAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "user", "document_version_id", "revision", "updated_at")
    search_fields = ("user__email", "document_version_id")
    readonly_fields = (
        "user",
        "document_id",
        "document_version_id",
        "revision",
        "created_at",
        "updated_at",
    )

    def has_add_permission(self, request: object) -> bool:
        return False

    def has_delete_permission(self, request: object, obj: object | None = None) -> bool:
        return False


@admin.register(FocusAnnotation)
class FocusAnnotationAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "collection", "page_number", "tool", "revision", "updated_at")
    list_filter = ("tool", "deleted_at")
    search_fields = ("collection__user__email", "collection__document_version_id")
    readonly_fields = (
        "collection",
        "page_number",
        "tool",
        "layer_key",
        "bounds",
        "payload",
        "color",
        "thickness",
        "opacity",
        "revision",
        "deleted_at",
        "created_at",
        "updated_at",
    )

    def has_add_permission(self, request: object) -> bool:
        return False

    def has_delete_permission(self, request: object, obj: object | None = None) -> bool:
        return False


@admin.register(FocusSyncReceipt)
class FocusSyncReceiptAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "collection", "requested_by", "idempotency_key", "created_at")
    search_fields = ("collection__user__email", "idempotency_key")
    readonly_fields = (
        "collection",
        "requested_by",
        "idempotency_key",
        "request_digest",
        "response_payload",
        "created_at",
    )

    def has_add_permission(self, request: object) -> bool:
        return False

    def has_delete_permission(self, request: object, obj: object | None = None) -> bool:
        return False

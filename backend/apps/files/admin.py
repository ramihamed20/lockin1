from django.contrib import admin

from .models import ManagedFile


@admin.register(ManagedFile)
class ManagedFileAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = (
        "original_name",
        "kind",
        "owner",
        "size_bytes",
        "validation_status",
        "scan_status",
        "scan_attempts",
    )
    list_filter = ("kind", "validation_status", "scan_status")
    search_fields = ("original_name", "checksum_sha256", "owner__email")
    readonly_fields = (
        "checksum_sha256",
        "size_bytes",
        "content_type",
        "validation_status",
        "scan_status",
        "scan_attempts",
        "scan_requested_at",
        "scan_started_at",
        "scan_completed_at",
        "scan_next_attempt_at",
        "scan_engine",
        "scan_signature",
        "scan_error_code",
    )

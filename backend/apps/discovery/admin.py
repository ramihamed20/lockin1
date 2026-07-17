from django.contrib import admin

from .models import SearchEntry


@admin.register(SearchEntry)
class SearchEntryAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("title", "resource_kind", "content_type", "is_discoverable")
    list_filter = ("resource_kind", "content_type", "is_discoverable")
    search_fields = ("title", "normalized_title")
    readonly_fields = ("resource_kind", "resource_id", "updated_at")

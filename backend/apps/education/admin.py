from django.contrib import admin

from .models import CreatorScope, EducationNode


@admin.register(EducationNode)
class EducationNodeAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("title", "kind", "status", "is_discoverable", "position")
    list_filter = ("kind", "status", "is_discoverable")
    search_fields = ("title", "slug", "path")
    readonly_fields = ("path", "depth", "is_discoverable", "revision")


@admin.register(CreatorScope)
class CreatorScopeAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("user", "node", "can_create_content", "can_publish_content")
    list_select_related = ("user", "node", "granted_by")

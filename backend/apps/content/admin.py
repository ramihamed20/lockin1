from django.contrib import admin

from .models import LearningObject, LearningObjectAsset, LearningObjectVersion


class LearningObjectVersionInline(admin.TabularInline):  # type: ignore[type-arg]
    model = LearningObjectVersion
    extra = 0
    can_delete = False
    readonly_fields = (
        "version_number",
        "academic_node",
        "content_type",
        "title",
        "summary",
        "language",
        "created_by",
        "created_at",
    )


@admin.register(LearningObject)
class LearningObjectAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("id", "owner", "workflow_status", "revision", "published_at")
    list_filter = ("workflow_status",)
    list_select_related = ("owner", "current_version", "published_version")
    readonly_fields = ("current_version", "published_version", "revision")
    inlines = (LearningObjectVersionInline,)


@admin.register(LearningObjectAsset)
class LearningObjectAssetAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    list_display = ("version", "role", "managed_file", "position")
    list_select_related = ("version", "managed_file")

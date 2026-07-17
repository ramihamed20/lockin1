from django.contrib import admin
from django.http import HttpRequest

from .models import (
    Comment,
    CommentRevision,
    CommunityRateBucket,
    CommunitySpace,
    Discussion,
    DiscussionRevision,
    SpaceMembership,
    SpaceMembershipHistory,
)

admin.site.register(CommunitySpace)
admin.site.register(SpaceMembership)
admin.site.register(Discussion)
admin.site.register(Comment)
admin.site.register(CommunityRateBucket)


class AppendOnlyAdmin(admin.ModelAdmin):  # type: ignore[type-arg]
    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: object | None = None) -> bool:
        return False


@admin.register(SpaceMembershipHistory)
class SpaceMembershipHistoryAdmin(AppendOnlyAdmin):
    list_display = ("space", "membership", "actor", "action", "role", "created_at")
    readonly_fields = ("id", "space", "membership", "actor", "action", "role", "created_at")


@admin.register(DiscussionRevision)
class DiscussionRevisionAdmin(AppendOnlyAdmin):
    list_display = ("discussion", "revision", "editor", "reason", "created_at")
    readonly_fields = (
        "id",
        "discussion",
        "editor",
        "revision",
        "title",
        "body",
        "reason",
        "note",
        "created_at",
    )


@admin.register(CommentRevision)
class CommentRevisionAdmin(AppendOnlyAdmin):
    list_display = ("comment", "revision", "editor", "reason", "created_at")
    readonly_fields = (
        "id",
        "comment",
        "editor",
        "revision",
        "body",
        "reason",
        "note",
        "created_at",
    )

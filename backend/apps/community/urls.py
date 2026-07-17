from django.urls import path

from .views import (
    CommentDetailView,
    CommentListView,
    DiscussionDetailView,
    DiscussionListView,
    SpaceDetailView,
    SpaceListView,
    SpaceMemberDetailView,
    SpaceMemberListView,
)

app_name = "community"

urlpatterns = [
    path("community/discussions", DiscussionListView.as_view(), name="discussion-list"),
    path(
        "community/discussions/<uuid:discussion_id>",
        DiscussionDetailView.as_view(),
        name="discussion-detail",
    ),
    path(
        "community/discussions/<uuid:discussion_id>/comments",
        CommentListView.as_view(),
        name="comment-list",
    ),
    path(
        "community/comments/<uuid:comment_id>",
        CommentDetailView.as_view(),
        name="comment-detail",
    ),
    path("community/spaces", SpaceListView.as_view(), name="space-list"),
    path("community/spaces/<uuid:space_id>", SpaceDetailView.as_view(), name="space-detail"),
    path(
        "community/spaces/<uuid:space_id>/members",
        SpaceMemberListView.as_view(),
        name="space-member-add",
    ),
    path(
        "community/spaces/<uuid:space_id>/members/<uuid:user_id>",
        SpaceMemberDetailView.as_view(),
        name="space-member-remove",
    ),
]

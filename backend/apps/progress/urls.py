from django.urls import path

from .views import (
    BookmarkDetailView,
    BookmarkListView,
    CatalogBookmarkDetailView,
    LearningDashboardView,
    LearningProgressDetailView,
    LessonCompleteView,
    ResumeListView,
)

app_name = "progress"

urlpatterns = [
    path("bookmarks", BookmarkListView.as_view(), name="bookmark-list"),
    path(
        "bookmarks/<uuid:learning_object_id>",
        BookmarkDetailView.as_view(),
        name="bookmark-detail",
    ),
    path(
        "bookmarks/catalog/<slug:material_slug>/<slug:sheet_slug>",
        CatalogBookmarkDetailView.as_view(),
        name="catalog-bookmark-detail",
    ),
    path("progress/resume", ResumeListView.as_view(), name="resume-list"),
    path(
        "progress/learning-objects/<uuid:learning_object_id>",
        LearningProgressDetailView.as_view(),
        name="learning-progress",
    ),
    path(
        "progress/lessons/<uuid:lesson_id>/complete",
        LessonCompleteView.as_view(),
        name="lesson-complete",
    ),
    path("learning/dashboard", LearningDashboardView.as_view(), name="learning-dashboard"),
]

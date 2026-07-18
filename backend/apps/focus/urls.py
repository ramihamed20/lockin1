from django.urls import path

from .views import (
    FocusAnnotationsView,
    FocusDocumentView,
    FocusSessionActionView,
    FocusSessionListCreateView,
    FocusWorkspaceStateView,
)

app_name = "focus"

urlpatterns = [
    path("focus/documents/<uuid:document_version_id>", FocusDocumentView.as_view()),
    path(
        "focus/documents/<uuid:document_version_id>/annotations",
        FocusAnnotationsView.as_view(),
    ),
    path("focus/sessions", FocusSessionListCreateView.as_view()),
    path(
        "focus/sessions/<uuid:session_id>/workspace",
        FocusWorkspaceStateView.as_view(),
    ),
    path(
        "focus/sessions/<uuid:session_id>/<str:action>",
        FocusSessionActionView.as_view(),
    ),
]

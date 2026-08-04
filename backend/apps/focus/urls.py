from django.urls import path

from .views import (
    FocusAnnotationsView,
    FocusDocumentView,
    FocusSessionActionView,
    FocusSessionListCreateView,
    FocusWorkspaceStateView,
    LockInActionView,
    LockInBootstrapView,
    LockInNoteView,
    LockInSessionView,
    LockInTeamJoinView,
    LockInTeamMessagesView,
    LockInTeamsView,
    LockInTaskToggleView,
    LockInTasksView,
)

app_name = "focus"

urlpatterns = [
    path("focus/documents/<uuid:document_version_id>", FocusDocumentView.as_view()),
    path(
        "focus/documents/<uuid:document_version_id>/annotations",
        FocusAnnotationsView.as_view(),
    ),
    path("focus/sessions", FocusSessionListCreateView.as_view()),
    path("focus/lock-in", LockInBootstrapView.as_view()),
    path("focus/lock-in/teams", LockInTeamsView.as_view()),
    path("focus/lock-in/teams/join", LockInTeamJoinView.as_view()),
    path("focus/lock-in/teams/<uuid:team_id>/messages", LockInTeamMessagesView.as_view()),
    path("focus/lock-in/<uuid:session_id>", LockInSessionView.as_view()),
    path("focus/lock-in/<uuid:session_id>/note", LockInNoteView.as_view()),
    path("focus/lock-in/<uuid:session_id>/tasks", LockInTasksView.as_view()),
    path(
        "focus/lock-in/<uuid:session_id>/tasks/<uuid:task_id>/toggle",
        LockInTaskToggleView.as_view(),
    ),
    path(
        "focus/lock-in/<uuid:session_id>/<str:action>",
        LockInActionView.as_view(),
    ),
    path(
        "focus/sessions/<uuid:session_id>/workspace",
        FocusWorkspaceStateView.as_view(),
    ),
    path(
        "focus/sessions/<uuid:session_id>/<str:action>",
        FocusSessionActionView.as_view(),
    ),
]

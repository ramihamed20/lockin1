from django.urls import path

from .views import (
    ArtifactView,
    AttemptView,
    BootstrapView,
    LibraryView,
    McqExplainLinksView,
    McqRunExplainLinksView,
)

app_name = "knowledge"
urlpatterns = [
    path("knowledge/library", LibraryView.as_view(), name="library"),
    path(
        "knowledge/documents/<uuid:document_id>/mcq-runs/<uuid:run_id>/explain-links",
        McqRunExplainLinksView.as_view(),
        name="mcq-run-explain-links",
    ),
    path(
        "knowledge/documents/<uuid:document_id>/mcq-attempts/<uuid:attempt_id>/explain-links",
        McqExplainLinksView.as_view(),
        name="mcq-explain-links",
    ),
    path("knowledge/documents/<uuid:document_id>", BootstrapView.as_view(), name="bootstrap"),
    path(
        "knowledge/documents/<uuid:document_id>/artifacts/<uuid:artifact_id>",
        ArtifactView.as_view(),
        name="artifact",
    ),
    path(
        "knowledge/documents/<uuid:document_id>/attempts/<uuid:attempt_id>",
        AttemptView.as_view(),
        name="attempt",
    ),
]

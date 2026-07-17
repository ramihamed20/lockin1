from django.urls import path

from .views import (
    ModerationAuditView,
    ReportAssignView,
    ReportDetailView,
    ReportListView,
    ReportTransitionView,
)

app_name = "moderation"

urlpatterns = [
    path("moderation/reports", ReportListView.as_view(), name="report-list"),
    path("moderation/reports/<uuid:report_id>", ReportDetailView.as_view(), name="report-detail"),
    path(
        "moderation/reports/<uuid:report_id>/assign",
        ReportAssignView.as_view(),
        name="report-assign",
    ),
    path(
        "moderation/reports/<uuid:report_id>/transition",
        ReportTransitionView.as_view(),
        name="report-transition",
    ),
    path("moderation/audit", ModerationAuditView.as_view(), name="audit"),
]

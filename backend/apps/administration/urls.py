from django.urls import path

from .automation_views import AutomationJobDetailView, AutomationJobListView
from .reference_views import (
    SubjectReferenceHistoryView,
    SubjectReferenceListView,
    SubjectReferencePDFView,
)
from .views import (
    ContentDashboardView,
    OperationalResourceListView,
    OperationalUserListView,
    OperationalUserRolesView,
    OperationsSessionView,
    OverviewDashboardView,
    SupportDashboardView,
    SystemHealthView,
)

app_name = "administration"

urlpatterns = [
    path(
        "operations/admin/automation/jobs", AutomationJobListView.as_view(), name="automation-jobs"
    ),
    path(
        "operations/admin/automation/jobs/<uuid:job_id>",
        AutomationJobDetailView.as_view(),
        name="automation-job",
    ),
    path(
        "operations/admin/automation/subjects/<uuid:subject_id>/references",
        SubjectReferenceListView.as_view(),
        name="automation-references",
    ),
    path(
        "operations/admin/automation/subjects/<uuid:subject_id>/references/<uuid:reference_id>/history",
        SubjectReferenceHistoryView.as_view(),
        name="automation-reference-history",
    ),
    path(
        "operations/admin/automation/subjects/<uuid:subject_id>/references/<uuid:reference_id>/pdf",
        SubjectReferencePDFView.as_view(),
        name="automation-reference-pdf",
    ),
    path("operations/session", OperationsSessionView.as_view(), name="session"),
    path("operations/resources", OperationalResourceListView.as_view(), name="resources"),
    path("operations/dashboards/overview", OverviewDashboardView.as_view(), name="overview"),
    path("operations/dashboards/content", ContentDashboardView.as_view(), name="content"),
    path("operations/dashboards/support", SupportDashboardView.as_view(), name="support"),
    path("operations/system-health", SystemHealthView.as_view(), name="system-health"),
    path("operations/users", OperationalUserListView.as_view(), name="users"),
    path(
        "operations/users/<uuid:user_id>/roles",
        OperationalUserRolesView.as_view(),
        name="user-roles",
    ),
]

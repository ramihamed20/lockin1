from django.urls import path

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

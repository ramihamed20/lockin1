from django.urls import path

from .views import (
    CreatorScopeDetailView,
    CreatorScopeListView,
    ManagementEducationNodeDetailView,
    ManagementEducationNodeListView,
    ManagementEducationNodeMoveView,
    ManagementEducationNodeStatusView,
    PublicEducationNodeDetailView,
    PublicEducationNodeListView,
)

app_name = "education"

urlpatterns = [
    path("education/nodes", PublicEducationNodeListView.as_view(), name="node-list"),
    path(
        "education/nodes/<uuid:node_id>",
        PublicEducationNodeDetailView.as_view(),
        name="node-detail",
    ),
    path(
        "management/education/nodes",
        ManagementEducationNodeListView.as_view(),
        name="management-node-list",
    ),
    path(
        "management/education/nodes/<uuid:node_id>",
        ManagementEducationNodeDetailView.as_view(),
        name="management-node-detail",
    ),
    path(
        "management/education/nodes/<uuid:node_id>/move",
        ManagementEducationNodeMoveView.as_view(),
        name="management-node-move",
    ),
    path(
        "management/education/nodes/<uuid:node_id>/status",
        ManagementEducationNodeStatusView.as_view(),
        name="management-node-status",
    ),
    path(
        "management/education/scopes",
        CreatorScopeListView.as_view(),
        name="creator-scope-list",
    ),
    path(
        "management/education/scopes/<uuid:scope_id>",
        CreatorScopeDetailView.as_view(),
        name="creator-scope-detail",
    ),
]

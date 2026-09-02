from django.urls import path

from .admin_views import (
    AdminSheetActionView,
    AdminSheetDetailView,
    AdminSheetPdfView,
    AdminSubjectListView,
    AdminSubjectSheetListView,
)
from .views import (
    ArchiveLearningObjectView,
    ManagementLearningObjectDetailView,
    ManagementLearningObjectListView,
    PublicLearningObjectDetailView,
    PublicLearningObjectListView,
    PublishLearningObjectView,
    RejectLearningObjectView,
    SubmitLearningObjectView,
    TransferLearningObjectView,
)

app_name = "content"

urlpatterns = [
    path(
        "operations/admin/content/subjects",
        AdminSubjectListView.as_view(),
        name="admin-subjects",
    ),
    path(
        "operations/admin/content/subjects/<uuid:subject_id>/sheets",
        AdminSubjectSheetListView.as_view(),
        name="admin-subject-sheets",
    ),
    path(
        "operations/admin/content/sheets/<uuid:sheet_id>",
        AdminSheetDetailView.as_view(),
        name="admin-sheet-detail",
    ),
    path(
        "operations/admin/content/sheets/<uuid:sheet_id>/actions",
        AdminSheetActionView.as_view(),
        name="admin-sheet-action",
    ),
    path(
        "operations/admin/content/sheets/<uuid:sheet_id>/pdf",
        AdminSheetPdfView.as_view(),
        name="admin-sheet-pdf",
    ),
    path("learning-objects", PublicLearningObjectListView.as_view(), name="public-list"),
    path(
        "learning-objects/<uuid:learning_object_id>",
        PublicLearningObjectDetailView.as_view(),
        name="public-detail",
    ),
    path(
        "management/content",
        ManagementLearningObjectListView.as_view(),
        name="management-list",
    ),
    path(
        "management/content/<uuid:learning_object_id>",
        ManagementLearningObjectDetailView.as_view(),
        name="management-detail",
    ),
    path(
        "management/content/<uuid:learning_object_id>/submit",
        SubmitLearningObjectView.as_view(),
        name="submit",
    ),
    path(
        "management/content/<uuid:learning_object_id>/publish",
        PublishLearningObjectView.as_view(),
        name="publish",
    ),
    path(
        "management/content/<uuid:learning_object_id>/reject",
        RejectLearningObjectView.as_view(),
        name="reject",
    ),
    path(
        "management/content/<uuid:learning_object_id>/archive",
        ArchiveLearningObjectView.as_view(),
        name="archive",
    ),
    path(
        "management/content/<uuid:learning_object_id>/transfer",
        TransferLearningObjectView.as_view(),
        name="transfer",
    ),
]

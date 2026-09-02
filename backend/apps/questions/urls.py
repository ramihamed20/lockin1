from django.urls import path

from .admin_views import (
    AdminQuestionBulkActionView,
    AdminQuestionImportHistoryView,
    AdminQuestionImportUndoView,
    AdminQuestionImportValidateView,
    AdminQuestionImportView,
    AdminSheetQuestionListView,
)
from .views import (
    ManagementQuestionDetailView,
    ManagementQuestionListView,
    PublishQuestionView,
    RejectQuestionView,
    RetireQuestionView,
    SubmitQuestionView,
)

app_name = "questions"

urlpatterns = [
    path(
        "operations/admin/content/sheets/<uuid:sheet_id>/questions",
        AdminSheetQuestionListView.as_view(),
        name="admin-sheet-questions",
    ),
    path(
        "operations/admin/content/sheets/<uuid:sheet_id>/questions/validate",
        AdminQuestionImportValidateView.as_view(),
        name="admin-question-import-validate",
    ),
    path(
        "operations/admin/content/sheets/<uuid:sheet_id>/questions/import",
        AdminQuestionImportView.as_view(),
        name="admin-question-import",
    ),
    path(
        "operations/admin/content/questions/bulk",
        AdminQuestionBulkActionView.as_view(),
        name="admin-question-bulk",
    ),
    path(
        "operations/admin/content/imports",
        AdminQuestionImportHistoryView.as_view(),
        name="admin-question-import-history",
    ),
    path(
        "operations/admin/content/imports/<uuid:batch_id>/undo",
        AdminQuestionImportUndoView.as_view(),
        name="admin-question-import-undo",
    ),
    path("management/questions", ManagementQuestionListView.as_view(), name="management-list"),
    path(
        "management/questions/<uuid:question_id>",
        ManagementQuestionDetailView.as_view(),
        name="management-detail",
    ),
    path(
        "management/questions/<uuid:question_id>/submit",
        SubmitQuestionView.as_view(),
        name="submit",
    ),
    path(
        "management/questions/<uuid:question_id>/publish",
        PublishQuestionView.as_view(),
        name="publish",
    ),
    path(
        "management/questions/<uuid:question_id>/reject",
        RejectQuestionView.as_view(),
        name="reject",
    ),
    path(
        "management/questions/<uuid:question_id>/retire",
        RetireQuestionView.as_view(),
        name="retire",
    ),
]

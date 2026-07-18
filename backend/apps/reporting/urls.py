from django.urls import path

from .views import ReportCatalogView, ReportExecuteView, ReportPreviewView

app_name = "reporting"

urlpatterns = [
    path("operations/reports", ReportCatalogView.as_view(), name="catalog"),
    path("operations/reports/previews", ReportPreviewView.as_view(), name="preview"),
    path(
        "operations/reports/<str:export_id>/execute",
        ReportExecuteView.as_view(),
        name="execute",
    ),
]

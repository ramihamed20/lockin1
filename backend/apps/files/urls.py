from django.urls import path

from .views import (
    ManagedFileDeliveryView,
    ManagedFileScanDecisionView,
    ManagedFileUploadView,
)

app_name = "files"

urlpatterns = [
    path("management/files", ManagedFileUploadView.as_view(), name="upload"),
    path(
        "operations/admin/files/<uuid:file_id>/scan-decision",
        ManagedFileScanDecisionView.as_view(),
        name="scan-decision",
    ),
    path(
        "files/<uuid:file_id>/<str:disposition>",
        ManagedFileDeliveryView.as_view(),
        name="delivery",
    ),
]

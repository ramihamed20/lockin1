from django.urls import path

from .views import ManagedFileDeliveryView, ManagedFileUploadView

app_name = "files"

urlpatterns = [
    path("management/files", ManagedFileUploadView.as_view(), name="upload"),
    path(
        "files/<uuid:file_id>/<str:disposition>",
        ManagedFileDeliveryView.as_view(),
        name="delivery",
    ),
]

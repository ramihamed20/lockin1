from django.urls import path

from .views import ConfigurationDetailView, ConfigurationListView

app_name = "system_configuration"

urlpatterns = [
    path("operations/configuration", ConfigurationListView.as_view(), name="list"),
    path(
        "operations/configuration/<path:key>",
        ConfigurationDetailView.as_view(),
        name="detail",
    ),
]

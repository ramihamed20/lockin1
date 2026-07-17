from django.urls import include, path

from .views import live, ready

app_name = "platform_core"

urlpatterns = [
    path("health/live", live, name="health-live"),
    path("health/ready", ready, name="health-ready"),
    path("", include("apps.accounts.urls")),
    path("", include("apps.education.urls")),
    path("", include("apps.files.urls")),
    path("", include("apps.content.urls")),
    path("", include("apps.discovery.urls")),
    path("", include("apps.progress.urls")),
]

from django.urls import include, path

from .views import live, ready

app_name = "platform_core"

urlpatterns = [
    path("health/live", live, name="health-live"),
    path("health/ready", ready, name="health-ready"),
    path("", include("apps.accounts.urls")),
]

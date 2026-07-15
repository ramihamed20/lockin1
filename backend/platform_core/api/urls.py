from django.urls import path

from .views import live, ready

app_name = "platform_core"

urlpatterns = [
    path("health/live", live, name="health-live"),
    path("health/ready", ready, name="health-ready"),
]

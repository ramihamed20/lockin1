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
    path("", include("apps.questions.urls")),
    path("", include("apps.assessments.urls")),
    path("", include("apps.community.urls")),
    path("", include("apps.moderation.urls")),
    path("", include("apps.xp.urls")),
    path("", include("apps.streaks.urls")),
    path("", include("apps.achievements.urls")),
    path("", include("apps.rankings.urls")),
    path("", include("apps.notifications.urls")),
]

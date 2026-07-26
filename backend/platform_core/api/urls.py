from django.urls import include, path

from .views import live, ready

app_name = "platform_core"

urlpatterns = [
    path("health/live", live, name="health-live"),
    path("health/ready", ready, name="health-ready"),
    path("", include("apps.accounts.urls")),
    path("", include("apps.focus.urls")),
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
    path("", include("apps.product_catalog.urls")),
    path("", include("apps.subscriptions.urls")),
    path("", include("apps.entitlements.urls")),
    path("", include("apps.payments.urls")),
    path("", include("apps.invoices.urls")),
    path("", include("apps.refunds.urls")),
    path("", include("apps.provider_integrations.urls")),
    path("", include("apps.administration.urls")),
    path("", include("apps.analytics.urls")),
    path("", include("apps.audit.urls")),
    path("", include("apps.reporting.urls")),
    path("", include("apps.operational_actions.urls")),
    path("", include("apps.system_configuration.urls")),
    path("", include("apps.admin_control.urls")),
]

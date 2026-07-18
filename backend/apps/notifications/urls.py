from django.urls import path

from .views import (
    NotificationListView,
    NotificationOpenView,
    NotificationPreferenceView,
    NotificationReadAllView,
    NotificationReadView,
    NotificationSummaryView,
    PlatformNoticeView,
)

app_name = "notifications"

urlpatterns = [
    path("notifications", NotificationListView.as_view(), name="list"),
    path("notifications/summary", NotificationSummaryView.as_view(), name="summary"),
    path("notifications/read-all", NotificationReadAllView.as_view(), name="read-all"),
    path("notifications/preferences", NotificationPreferenceView.as_view(), name="preferences"),
    path("notifications/platform-notices", PlatformNoticeView.as_view(), name="platform-notice"),
    path("notifications/<uuid:notification_id>/read", NotificationReadView.as_view(), name="read"),
    path("notifications/<uuid:notification_id>/open", NotificationOpenView.as_view(), name="open"),
]

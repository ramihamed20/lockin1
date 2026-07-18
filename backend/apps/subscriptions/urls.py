from django.urls import path

from .views import (
    AdminSubscriptionTransitionView,
    CancelSubscriptionView,
    CurrentSubscriptionView,
)

app_name = "subscriptions"

urlpatterns = [
    path("subscriptions/current", CurrentSubscriptionView.as_view(), name="current"),
    path("subscriptions/current/cancel", CancelSubscriptionView.as_view(), name="cancel"),
    path(
        "subscriptions/admin/<uuid:subscription_id>/transition",
        AdminSubscriptionTransitionView.as_view(),
        name="admin-transition",
    ),
]

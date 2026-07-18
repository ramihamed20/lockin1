from django.urls import path

from .views import ProviderWebhookView

app_name = "provider_integrations"

urlpatterns = [
    path("billing/webhooks/<slug:provider>", ProviderWebhookView.as_view(), name="webhook"),
]

from django.urls import path

from .telegram_views import TelegramWebhookView
from .views import ManualLibyanaPaymentView, MyPaymentsView, PaymentIntentView

app_name = "payments"

urlpatterns = [
    path("payments", MyPaymentsView.as_view(), name="mine"),
    path("payments/intents", PaymentIntentView.as_view(), name="intent"),
    path("payments/manual-libyana", ManualLibyanaPaymentView.as_view(), name="manual-libyana"),
    # Public by URL, authenticated by the secret header Telegram echoes. Kept
    # under billing/ alongside the provider webhook it resembles.
    path(
        "billing/webhooks/telegram",
        TelegramWebhookView.as_view(),
        name="telegram-webhook",
    ),
]

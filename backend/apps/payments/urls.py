from django.urls import path

from .views import MyPaymentsView, PaymentIntentView

app_name = "payments"

urlpatterns = [
    path("payments", MyPaymentsView.as_view(), name="mine"),
    path("payments/intents", PaymentIntentView.as_view(), name="intent"),
]

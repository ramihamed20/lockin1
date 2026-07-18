from django.urls import path

from .views import AdminRefundRequestView, MyRefundsView

app_name = "refunds"

urlpatterns = [
    path("refunds", MyRefundsView.as_view(), name="mine"),
    path("admin/refunds", AdminRefundRequestView.as_view(), name="admin-request"),
]

from django.urls import path

from .views import MyInvoicesView

app_name = "invoices"

urlpatterns = [path("invoices", MyInvoicesView.as_view(), name="mine")]

from django.urls import path

from .views import XpLedgerView, XpSummaryView

app_name = "xp"

urlpatterns = [
    path("progression/xp", XpSummaryView.as_view(), name="summary"),
    path("progression/xp/ledger", XpLedgerView.as_view(), name="ledger"),
]

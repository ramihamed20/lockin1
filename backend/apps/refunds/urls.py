from django.urls import path

from .claim_views import (
    FinanceRefundClaimReviewView,
    FinanceRefundClaimsView,
    MyRefundClaimDetailsView,
    MyRefundClaimsView,
)
from .views import AdminRefundRequestView, MyRefundsView

app_name = "refunds"

urlpatterns = [
    path("refund-requests", MyRefundClaimsView.as_view(), name="requests"),
    path(
        "refund-requests/<uuid:claim_id>",
        MyRefundClaimDetailsView.as_view(),
        name="request-contact",
    ),
    path(
        "operations/admin/refund-requests",
        FinanceRefundClaimsView.as_view(),
        name="finance-requests",
    ),
    path(
        "operations/admin/refund-requests/<uuid:claim_id>",
        FinanceRefundClaimReviewView.as_view(),
        name="finance-review",
    ),
    path("refunds", MyRefundsView.as_view(), name="mine"),
    path("admin/refunds", AdminRefundRequestView.as_view(), name="admin-request"),
]

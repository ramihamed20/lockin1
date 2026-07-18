from django.urls import path

from .views import AdminManualEntitlementView, MyEntitlementDecisionView, MyEntitlementsView

app_name = "entitlements"

urlpatterns = [
    path("entitlements/me", MyEntitlementsView.as_view(), name="mine"),
    path(
        "entitlements/me/<path:entitlement_code>",
        MyEntitlementDecisionView.as_view(),
        name="decision",
    ),
    path("entitlements/admin/grants", AdminManualEntitlementView.as_view(), name="admin-grant"),
]

from django.urls import path

from .views import (
    AdminAnalyticsDashboardView,
    AdminEntitlementGrantView,
    AdminEntitlementInspectionView,
    AdminEntitlementRevokeView,
    AdminManualPaymentReviewView,
    AdminNotificationCampaignDispatchView,
    AdminNotificationCampaignListView,
    AdminPlanActionView,
    AdminPlanListView,
    AdminPurchaseCorrectionRequestView,
    AdminPurchaseCorrectionReviewView,
    AdminPurchaseDetailView,
    AdminPurchaseListView,
    AdminPurchaseRefundView,
    AdminRoleCatalogView,
    AdminSubscriptionActionView,
    AdminSubscriptionDetailView,
    AdminSubscriptionListView,
    AdminTargetNoteView,
    AdminUserActionView,
    AdminUserCapabilitiesView,
    AdminUserDetailView,
)

app_name = "admin_control"

urlpatterns = [
    path("operations/admin/purchases", AdminPurchaseListView.as_view(), name="purchases"),
    path(
        "operations/admin/purchases/<uuid:payment_id>",
        AdminPurchaseDetailView.as_view(),
        name="purchase-detail",
    ),
    path(
        "operations/admin/purchases/<uuid:payment_id>/manual-review",
        AdminManualPaymentReviewView.as_view(),
        name="purchase-manual-review",
    ),
    path(
        "operations/admin/purchases/<uuid:payment_id>/refunds",
        AdminPurchaseRefundView.as_view(),
        name="purchase-refund",
    ),
    path(
        "operations/admin/purchases/<uuid:payment_id>/corrections",
        AdminPurchaseCorrectionRequestView.as_view(),
        name="purchase-correction-request",
    ),
    path(
        "operations/admin/purchases/corrections/<uuid:correction_id>/review",
        AdminPurchaseCorrectionReviewView.as_view(),
        name="purchase-correction-review",
    ),
    path(
        "operations/admin/subscriptions", AdminSubscriptionListView.as_view(), name="subscriptions"
    ),
    path(
        "operations/admin/subscriptions/<uuid:subscription_id>",
        AdminSubscriptionDetailView.as_view(),
        name="subscription-detail",
    ),
    path(
        "operations/admin/subscriptions/<uuid:subscription_id>/actions",
        AdminSubscriptionActionView.as_view(),
        name="subscription-action",
    ),
    path(
        "operations/admin/users/<uuid:user_id>", AdminUserDetailView.as_view(), name="user-detail"
    ),
    path(
        "operations/admin/users/<uuid:user_id>/actions",
        AdminUserActionView.as_view(),
        name="user-action",
    ),
    path(
        "operations/admin/users/<uuid:user_id>/capabilities",
        AdminUserCapabilitiesView.as_view(),
        name="user-capabilities",
    ),
    path("operations/admin/roles", AdminRoleCatalogView.as_view(), name="role-catalog"),
    path(
        "operations/admin/users/<uuid:user_id>/entitlements",
        AdminEntitlementInspectionView.as_view(),
        name="user-entitlements",
    ),
    path(
        "operations/admin/users/<uuid:user_id>/entitlements/grants",
        AdminEntitlementGrantView.as_view(),
        name="entitlement-grant",
    ),
    path(
        "operations/admin/entitlements/grants/<uuid:grant_id>/revoke",
        AdminEntitlementRevokeView.as_view(),
        name="entitlement-revoke",
    ),
    path(
        "operations/admin/notes/<str:target_type>/<str:target_id>",
        AdminTargetNoteView.as_view(),
        name="target-notes",
    ),
    path(
        "operations/admin/analytics/dashboard",
        AdminAnalyticsDashboardView.as_view(),
        name="analytics-dashboard",
    ),
    path(
        "operations/admin/notifications/campaigns",
        AdminNotificationCampaignListView.as_view(),
        name="notification-campaigns",
    ),
    path(
        "operations/admin/notifications/campaigns/<uuid:campaign_id>/dispatch",
        AdminNotificationCampaignDispatchView.as_view(),
        name="notification-campaign-dispatch",
    ),
    path("operations/admin/plans", AdminPlanListView.as_view(), name="plans"),
    path(
        "operations/admin/plans/<uuid:plan_id>/actions",
        AdminPlanActionView.as_view(),
        name="plan-action",
    ),
]

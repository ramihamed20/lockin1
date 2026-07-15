from django.urls import path

from .views import (
    AdminUserListView,
    AdminUserRolesView,
    CsrfTokenView,
    CurrentSessionView,
    DashboardView,
    EmailChangeConfirmView,
    EmailChangeRequestView,
    LoginView,
    LogoutAllView,
    LogoutView,
    PasswordChangeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    ProfileView,
    RegisterView,
    ResendVerificationView,
    SessionDetailView,
    SessionListView,
    VerifyEmailView,
)

app_name = "accounts"

urlpatterns = [
    path("auth/csrf", CsrfTokenView.as_view(), name="csrf"),
    path("auth/register", RegisterView.as_view(), name="register"),
    path("auth/verify-email", VerifyEmailView.as_view(), name="verify-email"),
    path("auth/resend-verification", ResendVerificationView.as_view(), name="resend-verification"),
    path("auth/password-reset", PasswordResetRequestView.as_view(), name="password-reset"),
    path(
        "auth/password-reset/confirm",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("auth/login", LoginView.as_view(), name="login"),
    path("auth/logout", LogoutView.as_view(), name="logout"),
    path("auth/logout-all", LogoutAllView.as_view(), name="logout-all"),
    path("auth/session", CurrentSessionView.as_view(), name="session"),
    path("account/profile", ProfileView.as_view(), name="profile"),
    path("account/password", PasswordChangeView.as_view(), name="password-change"),
    path("account/email", EmailChangeRequestView.as_view(), name="email-change"),
    path("account/email/confirm", EmailChangeConfirmView.as_view(), name="email-change-confirm"),
    path("account/sessions", SessionListView.as_view(), name="sessions"),
    path("account/sessions/<uuid:session_id>", SessionDetailView.as_view(), name="session-detail"),
    path("dashboard", DashboardView.as_view(), name="dashboard"),
    path("admin/users", AdminUserListView.as_view(), name="admin-users"),
    path("admin/users/<uuid:user_id>/roles", AdminUserRolesView.as_view(), name="admin-user-roles"),
]

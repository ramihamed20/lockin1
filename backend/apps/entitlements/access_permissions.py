from typing import TYPE_CHECKING

from rest_framework.permissions import BasePermission

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role
from apps.subscriptions.services import create_trial_for_user

from .services import entitlement_decision

if TYPE_CHECKING:
    from rest_framework.request import Request
    from rest_framework.views import APIView


PROTECTED_APP_ENTITLEMENTS = {
    "focus": "focus.workspace",
    "content": "content.premium",
    "files": "content.premium",
    "discovery": "content.premium",
    "progress": "content.premium",
    "review": "content.premium",
    "study_plans": "content.premium",
    "questions": "content.premium",
    "assessments": "content.premium",
}


class SubscriptionProtectedPermission(BasePermission):
    """Global, server-side subscription gate for study API domains."""

    message = "An active Lock-in subscription is required for this study feature."

    def has_permission(self, request: "Request", view: "APIView") -> bool:
        if "/operations/" in request.path or "/admin/" in request.path:
            return True
        match = request.resolver_match
        app_name = match.app_names[-1] if match and match.app_names else ""
        entitlement = PROTECTED_APP_ENTITLEMENTS.get(app_name)
        if entitlement is None:
            return True
        user = request.user
        if not isinstance(user, User) or not user.is_authenticated:
            return False
        if user_has_role(user, Role.ADMINISTRATOR):
            return True
        decision = entitlement_decision(user=user, entitlement_code=entitlement)
        if decision.allowed:
            return True
        if user.is_email_verified:
            create_trial_for_user(
                user=user,
                source_reference="entitlement-policy-reconciliation",
            )
            decision = entitlement_decision(user=user, entitlement_code=entitlement)
        return decision.allowed

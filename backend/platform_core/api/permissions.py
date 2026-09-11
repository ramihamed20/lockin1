"""Server-side feature gating for API domains that are not launched yet.

A screen that says "coming soon" is a decision about the front end only. The
endpoints behind it stay routed, authenticated and writable, so anyone can skip
the screen and call them directly -- which for Community means user-generated
content accumulating in an unlaunched, unmoderated surface.

This mirrors ``SubscriptionProtectedPermission``: one global permission that
keys off the resolved app name, so an unlaunched domain is closed everywhere at
once rather than per view, and cannot be reopened by adding a view and
forgetting the guard.
"""

from typing import TYPE_CHECKING

from django.conf import settings
from rest_framework.permissions import BasePermission

if TYPE_CHECKING:
    from rest_framework.request import Request
    from rest_framework.views import APIView


# app label -> settings flag that must be true for the domain to answer.
FEATURE_FLAGGED_APPS = {
    "community": "COMMUNITY_ENABLED",
}


class FeatureEnabledPermission(BasePermission):
    """Close an unlaunched API domain unless its deployment turns it on."""

    message = "This feature is not available yet."

    def has_permission(self, request: "Request", view: "APIView") -> bool:
        match = request.resolver_match
        app_name = match.app_names[-1] if match and match.app_names else ""
        flag = FEATURE_FLAGGED_APPS.get(app_name)
        if flag is None:
            return True
        return bool(getattr(settings, flag, False))

import logging
from typing import TYPE_CHECKING

from django.db import DatabaseError
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from apps.accounts.models import User
from apps.product_catalog.models import Plan
from apps.subscriptions.services import create_trial_for_user
from platform_core.observability import providers

from .services import EntitlementDecision, entitlement_decision

if TYPE_CHECKING:
    from rest_framework.request import Request
    from rest_framework.views import APIView


logger = logging.getLogger("lockin.entitlements")


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

# Views that decide entitlement per object rather than per app.
#
# The app-wide gate above is a blunt instrument: it asks "may this account reach
# the files domain at all", and for one route that question is wrong. Managed
# file delivery serves both premium study material and profile avatars, and
# ``can_access_managed_file`` already states that an avatar is readable by any
# authenticated account. Gating the whole app on ``content.premium`` therefore
# broke every avatar in the product the moment a subscription lapsed -- on the
# account screen and on the renewal screen itself.
#
# Naming the view here does not remove the check; it moves it. The view is
# required to call ``require_subscription_access`` for every object that is not
# an avatar, which is a strictly narrower and more accurate test than the app
# name. ``apps.files.tests`` holds the regression that keeps premium closed.
PER_OBJECT_ENTITLEMENT_VIEWS = frozenset({"files:delivery"})


def subscription_access_decision(*, user: User, entitlement_code: str) -> EntitlementDecision:
    """Decide entitlement, reconciling the trial an eligible account should already hold.

    Reconciliation is deliberate: a verified account that somehow reaches a
    protected domain without a subscription row gets the trial it was entitled
    to at verification, rather than a denial it cannot act on.
    """

    decision = entitlement_decision(user=user, entitlement_code=entitlement_code)
    if decision.allowed or not user.is_email_verified:
        return decision
    try:
        create_trial_for_user(user=user, source_reference="entitlement-policy-reconciliation")
    except (Plan.DoesNotExist, ValueError) as error:
        # A missing, retired or unpublished trial plan is a deployment fault,
        # not a request fault. It used to escape a permission class as an
        # unhandled exception, which turned every study endpoint into a 500 for
        # every newly verified account. Fail closed on premium access instead,
        # and make the configuration fault loud enough to find.
        logger.error(
            "Trial plan is unavailable, so entitlement reconciliation was skipped",
            exc_info=error,
            extra={"entitlement_code": entitlement_code},
        )
        providers.metric_sink.increment(
            "entitlement.trial_plan.unavailable",
            attributes={"reason": type(error).__name__},
        )
        return decision
    except DatabaseError as error:
        logger.exception(
            "Entitlement reconciliation failed against the database",
            extra={"entitlement_code": entitlement_code},
        )
        providers.error_reporter.capture_exception(
            error, context={"stage": "entitlement-policy-reconciliation"}
        )
        return decision
    return entitlement_decision(user=user, entitlement_code=entitlement_code)


class SubscriptionProtectedPermission(BasePermission):
    """Global, server-side subscription gate for study API domains."""

    message = "An active Lock-in subscription is required for this study feature."

    def has_permission(self, request: "Request", view: "APIView") -> bool:
        match = request.resolver_match
        app_name = match.app_names[-1] if match and match.app_names else ""
        entitlement = PROTECTED_APP_ENTITLEMENTS.get(app_name)
        if entitlement is None:
            return True
        # Built from the app name rather than read from ``view_name``: these URLs
        # are included under the ``platform_core`` namespace, so ``view_name``
        # carries that prefix and would never match this set.
        if match is not None and f"{app_name}:{match.url_name}" in PER_OBJECT_ENTITLEMENT_VIEWS:
            # The view owns this decision and must reach the same gate itself.
            return True
        user = request.user
        if not isinstance(user, User) or not user.is_authenticated:
            return False
        return subscription_access_decision(user=user, entitlement_code=entitlement).allowed


def require_subscription_access(*, user: User, entitlement_code: str) -> None:
    """Apply the subscription gate inside a view listed in ``PER_OBJECT_ENTITLEMENT_VIEWS``.

    Raises the same ``PermissionDenied`` the global gate raises, so a caller that
    is not entitled sees exactly the response it saw before the exemption.
    """

    if not subscription_access_decision(user=user, entitlement_code=entitlement_code).allowed:
        raise PermissionDenied(SubscriptionProtectedPermission.message)

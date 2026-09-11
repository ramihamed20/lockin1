"""What a missing trial plan does to a request.

``subscription_access_decision`` reconciles the trial an eligible account should
already hold. That reconciliation reads the plan named by
``DEFAULT_TRIAL_PLAN_CODE``, and it used to do so from inside a permission class
with nothing catching ``Plan.DoesNotExist``. A retired or unpublished trial plan
therefore turned every protected study endpoint into a 500 for every newly
verified account -- a deployment fault answered as a server crash.

It must fail closed and stay visible instead.
"""

from typing import Any
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.entitlements.access_permissions import subscription_access_decision
from apps.product_catalog.models import Plan

pytestmark = pytest.mark.django_db


def test_absent_trial_plan_denies_access_without_raising(settings: Any) -> None:
    settings.DEFAULT_TRIAL_PLAN_CODE = "no-such-plan"
    user = create_user(email="no-trial-plan@example.com")
    client = APIClient()
    client.force_authenticate(user)

    response = client.get("/api/v1/progress/resume")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"


def test_absent_trial_plan_is_reported_as_a_configuration_fault(settings: Any) -> None:
    settings.DEFAULT_TRIAL_PLAN_CODE = "no-such-plan"
    user = create_user(email="observable-trial-plan@example.com")

    with patch("apps.entitlements.access_permissions.providers") as observability:
        decision = subscription_access_decision(user=user, entitlement_code="content.premium")

    assert decision.allowed is False
    observability.metric_sink.increment.assert_called_once()
    metric_name, keywords = observability.metric_sink.increment.call_args
    assert metric_name[0] == "entitlement.trial_plan.unavailable"
    assert keywords["attributes"] == {"reason": "DoesNotExist"}


def test_archived_trial_plan_denies_access_without_raising(settings: Any) -> None:
    """A plan that exists but is no longer active is the same fault.

    ``create_trial_for_user`` selects on ``status=ACTIVE``, so archiving the plan
    reaches the same ``DoesNotExist`` by a route an operator is far more likely
    to take by accident than deleting the row.
    """

    user = create_user(email="archived-trial-plan@example.com")
    Plan.objects.filter(code=settings.DEFAULT_TRIAL_PLAN_CODE).update(status=Plan.Status.ARCHIVED)
    client = APIClient()
    client.force_authenticate(user)

    response = client.get("/api/v1/progress/resume")

    assert response.status_code == 403


def test_a_healthy_trial_plan_still_reconciles_the_missing_trial() -> None:
    """The guard does not disable the reconciliation it protects.

    The trial is created and its entitlement is granted in the same transaction,
    so the very request that triggered the reconciliation is the one that gets
    through. That immediacy is the H6 change: the grant used to wait on an
    after-commit subscriber whose failures were swallowed.
    """

    user = create_user(email="reconciled-trial@example.com")

    with patch("apps.entitlements.access_permissions.providers") as observability:
        decision = subscription_access_decision(user=user, entitlement_code="content.premium")

    assert decision.allowed is True
    assert user.subscription_accounts.get().subscriptions.count() == 1
    observability.metric_sink.increment.assert_not_called()


def test_a_reader_reaches_study_content_on_the_request_that_created_the_trial() -> None:
    """End to end, through the permission class rather than the helper."""

    user = create_user(email="first-request-trial@example.com")
    client = APIClient()
    client.force_authenticate(user)

    response = client.get("/api/v1/progress/resume")

    assert response.status_code == 200

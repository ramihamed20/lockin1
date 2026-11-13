from uuid import uuid4

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.administration.models import OperationalCapabilityAssignment
from apps.education.tests.helpers import create_admin
from apps.feedback.models import FeedbackSuggestion

from .test_automation import JOBS

pytestmark = pytest.mark.django_db

CHECKS = (
    "student_checks",
    "subscription_checks",
    "payment_checks",
    "notification_checks",
    "feedback_checks",
    "moderation_checks",
    "analytics_checks",
    "system_checks",
)


@pytest.mark.parametrize("kind", CHECKS)
def test_operational_task_persists_real_findings(kind):
    client = APIClient()
    client.force_authenticate(create_admin())
    queued = client.post(JOBS, {"job_type": kind, "idempotency_key": str(uuid4())})
    assert queued.status_code == 201, queued.json()
    call_command("run_automation_worker", once=True)
    job = client.get(f"{JOBS}/{queued.json()['id']}").json()
    assert job["status"] == "completed", job
    assert job["output"]["schema"] == "lockin.operational_check.v1"
    assert job["output"]["findings"]
    assert job["attempts"][0]["result"] == "succeeded"


def test_running_a_check_is_idempotent_and_deduplicates_pending_jobs():
    client = APIClient()
    client.force_authenticate(create_admin())
    body = {"job_type": "student_checks", "idempotency_key": str(uuid4())}
    first = client.post(JOBS, body)
    assert first.status_code == 201
    replay = client.post(JOBS, body)
    assert replay.status_code == 200
    assert replay.json()["id"] == first.json()["id"]
    assert client.post(JOBS, {**body, "idempotency_key": str(uuid4())}).status_code == 409


def test_check_visibility_is_per_department_and_feedback_groups_verified_duplicates():
    operator = create_user(email="review@example.com")
    OperationalCapabilityAssignment.objects.create(user=operator, capability_id="moderation.view")
    FeedbackSuggestion.objects.create(message="Add  histology slides")
    FeedbackSuggestion.objects.create(message="add histology slides")
    client = APIClient()
    client.force_authenticate(operator)
    assert (
        client.post(
            JOBS, {"job_type": "payment_checks", "idempotency_key": str(uuid4())}
        ).status_code
        == 403
    )
    queued = client.post(JOBS, {"job_type": "feedback_checks", "idempotency_key": str(uuid4())})
    assert queued.status_code == 201
    call_command("run_automation_worker", once=True)
    job_id = queued.json()["id"]
    findings = client.get(f"{JOBS}/{job_id}").json()["output"]["findings"]
    assert findings["recurring_requests"] == [{"category": "feature", "matching_suggestions": 2}]
    client.force_authenticate(create_user(email="finance@example.com"))
    assert client.get(f"{JOBS}/{job_id}").status_code == 403


def test_subscription_check_finds_a_missing_grant_then_clears_after_convergence():
    from apps.admin_control.tests.test_admin_control import _subscription
    from apps.administration.operational_checks import subscription_checks
    from apps.entitlements.models import EntitlementDefinition, PlanEntitlementRule
    from apps.entitlements.services import sync_subscription_entitlements

    user = create_user()
    subscription = _subscription(user)
    entitlement, _ = EntitlementDefinition.objects.get_or_create(
        code="content.premium",
        defaults={"title": "Premium content"},
    )
    PlanEntitlementRule.objects.create(
        plan_version=subscription.plan_version, entitlement=entitlement
    )
    before = subscription_checks()
    assert before["expiring_within_14_days"]["count"] == 1
    assert before["missing_plan_grants"]["examples"] == [{"id": str(subscription.id)}]
    sync_subscription_entitlements(subscription_id=subscription.id)
    assert subscription_checks()["missing_plan_grants"]["count"] == 0

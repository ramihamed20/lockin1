from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.administration.catalog import Capability
from apps.administration.models import OperationalCapability, OperationalCapabilityAssignment
from apps.administration.permissions import has_operational_capability
from apps.administration.services import replace_operational_capabilities
from apps.audit.models import AuditRecord
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.notifications.models import Notification
from apps.product_catalog.models import Plan, PlanVersion, Price, Product
from apps.payments.models import Payment
from apps.payments.services import create_payment
from apps.subscriptions.models import Subscription, SubscriptionAccount

from apps.admin_control.models import NotificationCampaign, SubscriptionAdminEvent
from apps.admin_control.services import (
    create_notification_campaign,
    dispatch_notification_campaign,
    grant_access_override,
    manage_subscription,
    revoke_access_override,
    request_payment_status_correction,
    review_payment_status_correction,
)

pytestmark = pytest.mark.django_db


def _admin():
    return create_user(email="admin-control@example.com", is_superuser=True, is_staff=True)


def _subscription(user):
    product = Product.objects.create(code=f"product-{uuid4().hex[:8]}", title="Operations plan")
    plan = Plan.objects.create(product=product, code=f"plan-{uuid4().hex[:8]}", status=Plan.Status.ACTIVE)
    version = PlanVersion.objects.create(
        plan=plan,
        version=1,
        title="Operations plan version",
        published_at=datetime.now(UTC),
    )
    plan.current_version = version
    plan.save(update_fields=("current_version",))
    account = SubscriptionAccount.objects.create(
        kind=SubscriptionAccount.Kind.INDIVIDUAL,
        primary_user=user,
        display_name=user.full_name,
    )
    return Subscription.objects.create(
        account=account,
        plan_version=version,
        status=Subscription.Status.ACTIVE,
        started_at=datetime.now(UTC) - timedelta(days=2),
        current_period_started_at=datetime.now(UTC) - timedelta(days=2),
        current_period_ends_at=datetime.now(UTC) + timedelta(days=5),
    )


def test_subscription_extension_is_idempotent_and_audited() -> None:
    actor = _admin()
    target = create_user(email="subscriber@example.com")
    subscription = _subscription(target)
    extended_to = datetime.now(UTC) + timedelta(days=30)

    manage_subscription(
        subscription_id=subscription.id,
        action="extend",
        actor=actor,
        reason="Resolve verified billing support request.",
        idempotency_key="extend-subscription-request-001",
        period_ends_at=extended_to,
        source="test",
    )
    manage_subscription(
        subscription_id=subscription.id,
        action="extend",
        actor=actor,
        reason="Resolve verified billing support request.",
        idempotency_key="extend-subscription-request-001",
        period_ends_at=extended_to,
        source="test",
    )

    subscription.refresh_from_db()
    assert subscription.current_period_ends_at == extended_to
    assert SubscriptionAdminEvent.objects.filter(subscription=subscription).count() == 1
    assert AuditRecord.objects.filter(
        action="administration.subscription.extend", target_id=str(subscription.id)
    ).count() == 1


def test_manual_focus_override_has_immutable_audit_and_can_be_revoked() -> None:
    actor = _admin()
    target = create_user(email="focus-override@example.com")
    EntitlementDefinition.objects.get_or_create(
        code="focus.workspace", defaults={"title": "Focus Workspace"}
    )

    grant = grant_access_override(
        user=target,
        entitlement_code="focus.workspace",
        starts_at=datetime.now(UTC),
        ends_at=datetime.now(UTC) + timedelta(days=7),
        actor=actor,
        reason="Temporary accommodation approved by support.",
        source="test",
    )
    revoke_access_override(
        grant_id=grant.id,
        actor=actor,
        reason="Accommodation period has ended safely.",
        source="test",
    )

    grant.refresh_from_db()
    assert grant.status == EntitlementGrant.Status.REVOKED
    assert AuditRecord.objects.filter(action="administration.entitlement.granted").exists()
    assert AuditRecord.objects.filter(action="administration.entitlement.revoked").exists()


def test_campaign_delivers_real_in_app_notifications_and_audits() -> None:
    actor = _admin()
    recipient = create_user(email="campaign-recipient@example.com")
    campaign = create_notification_campaign(
        actor=actor,
        audience=NotificationCampaign.Audience.USER,
        audience_filter={"user_id": str(recipient.id)},
        title="Service notice",
        body="A real operational message for your account.",
        send_in_app=True,
        send_email=False,
        scheduled_for=None,
        reason="Communicate a verified operational change.",
        source="test",
    )
    completed = dispatch_notification_campaign(
        campaign_id=campaign.id,
        actor=actor,
        reason="Dispatch the approved service notice now.",
        source="test",
    )

    assert completed.status == NotificationCampaign.Status.COMPLETED
    assert Notification.objects.filter(recipient=recipient, data__campaign_id=str(campaign.id)).exists()
    assert AuditRecord.objects.filter(action="administration.notification_campaign.dispatched").exists()


def test_payment_correction_requires_a_different_admin_and_audits_the_change() -> None:
    requester = _admin()
    reviewer = create_user(email="finance-reviewer@example.com", is_superuser=True, is_staff=True)
    target = create_user(email="payment-correction@example.com")
    subscription = _subscription(target)
    price = Price.objects.create(
        plan_version=subscription.plan_version,
        code=f"price-{uuid4().hex[:8]}",
        amount_minor=1250,
        currency="USD",
        interval=Price.Interval.MONTH,
    )
    payment, _ = create_payment(
        account=subscription.account,
        subscription=subscription,
        price=price,
        idempotency_key="payment-correction-source-001",
    )
    correction = request_payment_status_correction(
        payment_id=payment.id,
        requested_status=Payment.Status.FAILED,
        provider_reference="verified-provider-case-1001",
        actor=requester,
        reason="Provider evidence confirms this payment failed.",
        idempotency_key="payment-correction-request-001",
        source="test",
    )
    with pytest.raises(ValueError, match="different administrator"):
        review_payment_status_correction(
            correction_id=correction.id,
            decision="approve",
            actor=requester,
            reason="Requester cannot independently approve it.",
            idempotency_key="payment-correction-approval-001",
            source="test",
        )
    reviewed = review_payment_status_correction(
        correction_id=correction.id,
        decision="approve",
        actor=reviewer,
        reason="Second administrator validated provider evidence.",
        idempotency_key="payment-correction-approval-001",
        source="test",
    )
    payment.refresh_from_db()
    assert reviewed.status == "approved"
    assert payment.status == Payment.Status.FAILED
    assert AuditRecord.objects.filter(action="administration.payment_correction.requested").exists()
    assert AuditRecord.objects.filter(action="administration.payment_correction.approved").exists()


def test_direct_operational_capabilities_are_backend_enforced_and_audited() -> None:
    actor = _admin()
    target = create_user(email="limited-operator@example.com")

    assigned = replace_operational_capabilities(
        target=target,
        actor=actor,
        capability_codes={Capability.USERS_VIEW},
        reason="Grant read-only support directory access.",
        source="test",
    )

    assert assigned == (Capability.USERS_VIEW,)
    assert has_operational_capability(target, Capability.USERS_VIEW)
    assert not has_operational_capability(target, Capability.PAYMENTS_MANAGE)
    assert OperationalCapabilityAssignment.objects.filter(user=target).exists()
    assert AuditRecord.objects.filter(action="administration.operational_capabilities.replaced").exists()


def test_admin_control_routes_deny_students_and_return_real_analytics() -> None:
    admin = _admin()
    student = create_user(email="student-control@example.com")
    admin_client = APIClient()
    admin_client.force_authenticate(admin)
    student_client = APIClient()
    student_client.force_authenticate(student)

    assert student_client.get("/api/v1/operations/admin/analytics/dashboard").status_code == 403
    response = admin_client.get("/api/v1/operations/admin/analytics/dashboard")
    assert response.status_code == 200
    assert response.json()["period"]["timezone"] == "UTC"
    assert "revenue" in response.json()


def test_content_and_assessment_capabilities_are_enforced_per_management_surface() -> None:
    content_operator = create_user(email="content-operator@example.com")
    assessment_operator = create_user(email="assessment-operator@example.com")
    content_capability = OperationalCapability.objects.get(code=Capability.CONTENT_MANAGE)
    assessment_capability = OperationalCapability.objects.get(code=Capability.ASSESSMENTS_MANAGE)
    OperationalCapabilityAssignment.objects.create(
        user=content_operator,
        capability=content_capability,
        reason="Content operations coverage.",
    )
    OperationalCapabilityAssignment.objects.create(
        user=assessment_operator,
        capability=assessment_capability,
        reason="Assessment operations coverage.",
    )
    content_client = APIClient(); content_client.force_authenticate(content_operator)
    assessment_client = APIClient(); assessment_client.force_authenticate(assessment_operator)

    assert content_client.get("/api/v1/management/content").status_code == 200
    assert content_client.get("/api/v1/management/questions").status_code == 403
    assert assessment_client.get("/api/v1/management/questions").status_code == 200
    assert assessment_client.get("/api/v1/management/content").status_code == 403


def test_configuration_patch_is_permissioned_versioned_and_audited() -> None:
    admin = _admin()
    reader = create_user(email="configuration-reader@example.com")
    OperationalCapabilityAssignment.objects.create(
        user=reader,
        capability=OperationalCapability.objects.get(code=Capability.CONFIGURATION_VIEW),
        reason="Read the non-secret platform configuration.",
    )
    admin_client = APIClient(); admin_client.force_authenticate(admin)
    reader_client = APIClient(); reader_client.force_authenticate(reader)
    entry = admin_client.get("/api/v1/operations/configuration").json()["results"][0]

    assert reader_client.patch(
        f"/api/v1/operations/configuration/{entry['key']}",
        {"value": entry["value"], "expected_version": entry["version"], "reason": "Attempt unauthorized configuration update."},
        format="json",
    ).status_code == 403
    response = admin_client.patch(
        f"/api/v1/operations/configuration/{entry['key']}",
        {"value": entry["value"], "expected_version": entry["version"], "reason": "Confirm typed configuration control path."},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["version"] == entry["version"] + 1
    assert AuditRecord.objects.filter(action="system_configuration.updated").exists()

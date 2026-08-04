from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.accounts.roles import Role
from apps.accounts.models import AccountSession
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
    AdminControlError,
    _campaign_recipients,
    _email_is_configured,
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


def test_direct_capability_cache_is_invalidated_after_an_operational_change() -> None:
    actor = _admin()
    target = create_user(email="capability-cache@example.com")

    assert not has_operational_capability(target, Capability.USERS_VIEW)
    replace_operational_capabilities(
        target=target,
        actor=actor,
        capability_codes={Capability.USERS_VIEW},
        reason="Grant support directory access after review.",
        source="test",
    )
    assert has_operational_capability(target, Capability.USERS_VIEW)
    replace_operational_capabilities(
        target=target,
        actor=actor,
        capability_codes=set(),
        reason="Remove access after the temporary support shift.",
        source="test",
    )
    assert not has_operational_capability(target, Capability.USERS_VIEW)


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


def test_admin_api_persists_purchase_subscription_user_note_and_entitlement_workflows() -> None:
    admin = _admin()
    reviewer = create_user(email="api-payment-reviewer@example.com", is_superuser=True, is_staff=True)
    target = create_user(email="api-admin-target@example.com")
    subscription = _subscription(target)
    price = Price.objects.create(
        plan_version=subscription.plan_version,
        code=f"api-price-{uuid4().hex[:8]}",
        amount_minor=1250,
        currency="USD",
        interval=Price.Interval.MONTH,
    )
    payment, _ = create_payment(
        account=subscription.account,
        subscription=subscription,
        price=price,
        idempotency_key="admin-api-purchase-source-001",
    )
    EntitlementDefinition.objects.get_or_create(
        code="focus.workspace", defaults={"title": "Focus Workspace"}
    )
    client = APIClient()
    client.force_authenticate(admin)
    reviewer_client = APIClient()
    reviewer_client.force_authenticate(reviewer)

    assert client.get("/api/v1/operations/admin/purchases").status_code == 200
    assert client.get(f"/api/v1/operations/admin/purchases/{payment.id}").status_code == 200
    # This exercises the defensive error path that must return a stable 400
    # instead of leaking a server error when an unsafe refund retry is sent.
    assert client.post(
        f"/api/v1/operations/admin/purchases/{payment.id}/refunds",
        {"amount_minor": 1, "reason": "Verify idempotency header validation."},
        format="json",
    ).status_code == 400
    requested = client.post(
        f"/api/v1/operations/admin/purchases/{payment.id}/corrections",
        {
            "requested_status": "failed",
            "provider_reference": "provider-case-api-1001",
            "reason": "Provider evidence confirms the failed payment.",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="payment-correction-api-request-001",
    )
    assert requested.status_code == 201
    reviewed = reviewer_client.post(
        f"/api/v1/operations/admin/purchases/corrections/{requested.json()['id']}/review",
        {"decision": "reject", "reason": "Second operator retained the recorded payment state."},
        format="json",
        HTTP_IDEMPOTENCY_KEY="payment-correction-api-review-001",
    )
    assert reviewed.status_code == 200

    assert client.get("/api/v1/operations/admin/subscriptions").status_code == 200
    assert client.get(f"/api/v1/operations/admin/subscriptions/{subscription.id}").status_code == 200
    extended_to = datetime.now(UTC) + timedelta(days=20)
    changed = client.post(
        f"/api/v1/operations/admin/subscriptions/{subscription.id}/actions",
        {
            "action": "extend",
            "period_ends_at": extended_to.isoformat(),
            "reason": "Extend the verified service period for this account.",
            "note": "API lifecycle regression coverage.",
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="subscription-api-extend-001",
    )
    assert changed.status_code == 200

    assert client.get(f"/api/v1/operations/admin/users/{target.id}").status_code == 200
    assert client.post(
        f"/api/v1/operations/admin/users/{target.id}/actions",
        {"action": "verify_email", "reason": "Confirm verified account contact after support review."},
        format="json",
    ).status_code == 200
    assert client.post(
        f"/api/v1/operations/admin/users/{target.id}/actions",
        {"action": "unverify_email", "reason": "Recheck account contact before final verification."},
        format="json",
    ).status_code == 200
    assert client.post(
        f"/api/v1/operations/admin/users/{target.id}/actions",
        {"action": "suspend", "reason": "Temporarily suspend the account for a verified review."},
        format="json",
    ).status_code == 200
    assert client.post(
        f"/api/v1/operations/admin/users/{target.id}/actions",
        {"action": "reactivate", "reason": "Restore access after the verified account review."},
        format="json",
    ).status_code == 200
    assert client.post(
        f"/api/v1/operations/admin/users/{target.id}/actions",
        {"action": "verify_email", "reason": "Restore verified contact before issuing account recovery."},
        format="json",
    ).status_code == 200
    assert client.post(
        f"/api/v1/operations/admin/users/{target.id}/actions",
        {"action": "logout_all", "reason": "Clear active sessions after the account review."},
        format="json",
    ).status_code == 200
    session = AccountSession.objects.create(
        user=target,
        session_key=f"admin-{uuid4().hex[:30]}",
        device_label="Regression browser",
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    assert client.post(
        f"/api/v1/operations/admin/users/{target.id}/actions",
        {
            "action": "logout_session",
            "session_id": str(session.id),
            "reason": "Revoke the selected session after the account review.",
        },
        format="json",
    ).status_code == 200
    assert client.post(
        f"/api/v1/operations/admin/users/{target.id}/actions",
        {"action": "password_reset", "reason": "Issue the approved password reset instruction."},
        format="json",
    ).status_code == 200
    assert client.post(
        f"/api/v1/operations/admin/users/{target.id}/actions",
        {
            "action": "replace_product_roles",
            "roles": ["creator"],
            "reason": "Assign the verified creator role for this account.",
        },
        format="json",
    ).status_code == 200
    assert client.get(f"/api/v1/operations/admin/users/{target.id}/capabilities").status_code == 200
    capabilities = client.patch(
        f"/api/v1/operations/admin/users/{target.id}/capabilities",
        {"capabilities": [Capability.USERS_VIEW], "reason": "Grant temporary directory support access."},
        format="json",
    )
    assert capabilities.status_code == 200
    assert client.get("/api/v1/operations/admin/roles").status_code == 200
    note = client.post(
        f"/api/v1/operations/admin/notes/accounts.user/{target.id}",
        {"body": "Support review completed.", "reason": "Record the verified account-support outcome."},
        format="json",
    )
    assert note.status_code == 201
    assert client.get(f"/api/v1/operations/admin/notes/accounts.user/{target.id}").status_code == 200
    assert client.get(f"/api/v1/operations/admin/users/{target.id}/entitlements").status_code == 200
    granted = client.post(
        f"/api/v1/operations/admin/users/{target.id}/entitlements/grants",
        {"entitlement_code": "focus.workspace", "reason": "Provide a verified temporary focus accommodation."},
        format="json",
    )
    assert granted.status_code == 201
    assert client.post(
        f"/api/v1/operations/admin/entitlements/grants/{granted.json()['id']}/revoke",
        {"reason": "Close the temporary accommodation after review."},
        format="json",
    ).status_code == 200


def test_admin_api_creates_dispatches_and_lifecycles_campaigns_and_plans() -> None:
    admin = _admin()
    recipient = create_user(email="campaign-api-recipient@example.com")
    product = Product.objects.create(
        code=f"api-product-{uuid4().hex[:8]}", title="API Operations Product"
    )
    client = APIClient()
    client.force_authenticate(admin)

    assert client.get("/api/v1/operations/admin/analytics/dashboard").status_code == 200
    assert client.get("/api/v1/operations/admin/notifications/campaigns").status_code == 200
    campaign = client.post(
        "/api/v1/operations/admin/notifications/campaigns",
        {
            "audience": "user",
            "audience_filter": {"user_id": str(recipient.id)},
            "title": "API service notice",
            "body": "This is a real in-app message sent through the operations workflow.",
            "send_in_app": True,
            "send_email": False,
            "reason": "Send the approved operations notice to one account.",
        },
        format="json",
    )
    assert campaign.status_code == 201
    dispatched = client.post(
        f"/api/v1/operations/admin/notifications/campaigns/{campaign.json()['id']}/dispatch",
        {"reason": "Dispatch the approved operations notice now."},
        format="json",
    )
    assert dispatched.status_code == 200
    assert dispatched.json()["status"] == NotificationCampaign.Status.COMPLETED

    assert client.get("/api/v1/operations/admin/plans").status_code == 200
    created = client.post(
        "/api/v1/operations/admin/plans",
        {
            "product_id": str(product.id),
            "plan_code": f"api_plan_{uuid4().hex[:8]}",
            "title": "API Operations Plan",
            "description": "Created by the authenticated operations API regression workflow.",
            "audience": "individual",
            "trial_days": 7,
            "grace_days": 3,
            "terms": {"version": "1"},
            "prices": [
                {
                    "code": f"api_plan_price_{uuid4().hex[:8]}",
                    "amount_minor": 1500,
                    "currency": "USD",
                    "currency_exponent": 2,
                    "interval": "month",
                    "interval_count": 1,
                }
            ],
            "publish": True,
            "reason": "Create an approved monthly operations plan version.",
        },
        format="json",
    )
    assert created.status_code == 201, created.json()
    plan_id = created.json()["id"]
    assert client.post(
        f"/api/v1/operations/admin/plans/{plan_id}/actions",
        {"action": "retire", "reason": "Retire the plan while reviewing its pricing."},
        format="json",
    ).status_code == 200
    restored = client.post(
        f"/api/v1/operations/admin/plans/{plan_id}/actions",
        {"action": "restore", "reason": "Restore the verified plan after pricing review."},
        format="json",
    )
    assert restored.status_code == 200
    assert restored.json()["status"] == Plan.Status.ACTIVE


def test_subscription_admin_lifecycle_actions_are_persisted_and_audited() -> None:
    actor = _admin()
    subscriber = create_user(email="subscription-action-target@example.com")
    subscription = _subscription(subscriber)
    alternative = _subscription(create_user(email="subscription-alternative@example.com"))
    cancellation = _subscription(create_user(email="subscription-cancellation@example.com"))

    suspended = manage_subscription(
        subscription_id=subscription.id,
        action="suspend",
        actor=actor,
        reason="Suspend access while the billing evidence is reviewed.",
        idempotency_key="subscription-action-suspend-001",
        source="test",
    )
    assert suspended.status == Subscription.Status.SUSPENDED
    reactivated = manage_subscription(
        subscription_id=subscription.id,
        action="reactivate",
        actor=actor,
        reason="Reactivate access after the billing evidence was verified.",
        idempotency_key="subscription-action-reactivate-001",
        source="test",
    )
    assert reactivated.status == Subscription.Status.ACTIVE
    scheduled = manage_subscription(
        subscription_id=subscription.id,
        action="cancel_period_end",
        actor=actor,
        reason="Schedule cancellation at the verified end of the period.",
        idempotency_key="subscription-action-period-end-001",
        source="test",
    )
    assert scheduled.cancel_at_period_end is True
    changed_plan = manage_subscription(
        subscription_id=subscription.id,
        action="change_plan",
        actor=actor,
        reason="Move the account to the verified replacement plan version.",
        idempotency_key="subscription-action-change-plan-001",
        plan_version_id=alternative.plan_version_id,
        source="test",
    )
    assert changed_plan.plan_version_id == alternative.plan_version_id
    cancelled = manage_subscription(
        subscription_id=cancellation.id,
        action="cancel_now",
        actor=actor,
        reason="Cancel the account immediately after the final support review.",
        idempotency_key="subscription-action-cancel-now-001",
        source="test",
    )
    assert cancelled.status == Subscription.Status.CANCELLED
    assert SubscriptionAdminEvent.objects.filter(subscription=subscription).count() == 4


def test_campaign_audiences_and_validation_cover_real_recipient_rules() -> None:
    actor = _admin()
    selected = create_user(email="campaign-selected@example.com")
    creator = create_user(email="campaign-creator@example.com")
    Group.objects.get(name=Role.CREATOR.value).user_set.add(creator)
    active_subscription = _subscription(create_user(email="campaign-active@example.com"))
    expired_subscription = _subscription(create_user(email="campaign-expired@example.com"))
    expired_subscription.status = Subscription.Status.CANCELLED
    expired_subscription.save(update_fields=("status", "updated_at"))
    trial_subscription = _subscription(create_user(email="campaign-trial@example.com"))
    trial_subscription.status = Subscription.Status.TRIALING
    trial_subscription.save(update_fields=("status", "updated_at"))

    def campaign(audience: str, audience_filter: dict[str, object] | None = None) -> NotificationCampaign:
        return NotificationCampaign.objects.create(
            audience=audience,
            audience_filter=audience_filter or {},
            title="Recipient routing coverage",
            body="Validate the persisted audience selector for this campaign.",
            created_by=actor,
            reason="Verify recipient routing for the approved campaign.",
        )

    assert list(_campaign_recipients(campaign("user", {"user_id": str(selected.id)}))) == [selected]
    assert selected in list(_campaign_recipients(campaign("selected_users", {"user_ids": [str(selected.id)]})))
    assert actor in list(_campaign_recipients(campaign("all_users")))
    assert creator in list(_campaign_recipients(campaign("creators")))
    assert active_subscription.account.primary_user in list(
        _campaign_recipients(campaign("active_subscribers"))
    )
    assert expired_subscription.account.primary_user in list(
        _campaign_recipients(campaign("expired_subscribers"))
    )
    assert trial_subscription.account.primary_user in list(
        _campaign_recipients(campaign("trial_users"))
    )
    assert active_subscription.account.primary_user in list(
        _campaign_recipients(
            campaign("plan_users", {"plan_code": active_subscription.plan_version.plan.code})
        )
    )
    assert _email_is_configured() is False
    assert list(_campaign_recipients(campaign("unsupported_audience"))) == []
    with pytest.raises(AdminControlError, match="notification audience"):
        create_notification_campaign(
            actor=actor,
            audience="unknown",
            audience_filter={},
            title="Invalid",
            body="Invalid",
            send_in_app=True,
            send_email=False,
            scheduled_for=None,
            reason="Reject an invalid campaign audience safely.",
            source="test",
        )
    with pytest.raises(AdminControlError, match="delivery channel"):
        create_notification_campaign(
            actor=actor,
            audience=NotificationCampaign.Audience.ALL_USERS,
            audience_filter={},
            title="No delivery",
            body="The service must reject campaigns with no delivery channel.",
            send_in_app=False,
            send_email=False,
            scheduled_for=None,
            reason="Reject a campaign that cannot be delivered safely.",
            source="test",
        )
    with pytest.raises(AdminControlError, match="title and body"):
        create_notification_campaign(
            actor=actor,
            audience=NotificationCampaign.Audience.ALL_USERS,
            audience_filter={},
            title=" ",
            body=" ",
            send_in_app=True,
            send_email=False,
            scheduled_for=None,
            reason="Reject a campaign without user-visible content safely.",
            source="test",
        )
    with pytest.raises(AdminControlError, match="future"):
        create_notification_campaign(
            actor=actor,
            audience=NotificationCampaign.Audience.ALL_USERS,
            audience_filter={},
            title="Expired schedule",
            body="The schedule must be in the future.",
            send_in_app=True,
            send_email=False,
            scheduled_for=datetime.now(UTC) - timedelta(minutes=1),
            reason="Reject an already elapsed campaign delivery schedule.",
            source="test",
        )
    delivered = create_notification_campaign(
        actor=actor,
        audience=NotificationCampaign.Audience.USER,
        audience_filter={"user_id": str(selected.id)},
        title="One-time completed campaign",
        body="The campaign state must not be dispatched twice.",
        send_in_app=True,
        send_email=False,
        scheduled_for=None,
        reason="Dispatch a one-time campaign to verify terminal state protection.",
        source="test",
    )
    dispatch_notification_campaign(
        campaign_id=delivered.id,
        actor=actor,
        reason="Dispatch the approved one-time notification campaign.",
        source="test",
    )
    with pytest.raises(AdminControlError, match="cannot be dispatched"):
        dispatch_notification_campaign(
            campaign_id=delivered.id,
            actor=actor,
            reason="Reject a duplicate dispatch after campaign completion.",
            source="test",
        )

import base64
from datetime import timedelta
from uuid import uuid4

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.policies import USER_POLICY_VERSION
from apps.accounts.tests.helpers import create_user
from apps.entitlements.models import EntitlementGrant
from apps.entitlements.services import entitlement_decision
from apps.payments.manual_services import review_manual_recharge
from apps.payments.models import InstallmentAgreement, ManualRechargeSubmission, Payment
from apps.payments.tests.test_manual_libyana import _monthly_plan_and_price, _submit, _trial_user
from apps.refunds.claim_services import create_claim, review_claim
from apps.refunds.models import Refund, RefundClaim
from apps.refunds.policy import activation_at, voluntary_rate
from apps.subscriptions.models import Subscription

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("legacy_duration_prices")]


@pytest.fixture(autouse=True)
def encryption_settings(settings):
    settings.PAYMENT_CODE_ENCRYPTION_KEY = base64.urlsafe_b64encode(b"a" * 32).decode()
    settings.TELEGRAM_BOT_TOKEN = ""
    settings.USER_POLICY_EFFECTIVE_AT = "2026-01-01T00:00:00+00:00"


def _paid(*, days=0, installments=False, policy=USER_POLICY_VERSION):
    user, sub = _trial_user(email=f"policy-{uuid4().hex[:12]}@example.com")
    user.policy_version = policy
    user.policy_accepted_at = timezone.now()
    user.save()
    client = APIClient()
    client.force_authenticate(user)
    plan, price = _monthly_plan_and_price()
    response = _submit(client, plan=plan, code="1234567890123", key=uuid4().hex)
    assert response.status_code == 201, response.json()
    payment = Payment.objects.get(id=response.json()["payment"]["id"])
    admin = create_user(email=f"finance-{uuid4().hex[:12]}@example.com", is_superuser=True)
    review_manual_recharge(
        payment_id=payment.id,
        actor=admin,
        decision="approve",
        reason="Card value verified",
        idempotency_key=uuid4().hex,
    )
    start = timezone.now() - timedelta(days=days)
    Payment.objects.filter(id=payment.id).update(succeeded_at=start)
    ManualRechargeSubmission.objects.filter(payment=payment).update(
        reviewed_at=start, subscription_period_started_at=start
    )
    if installments:
        agreement = InstallmentAgreement.objects.create(
            account=payment.account,
            subscription=sub,
            price=price,
            total_amount_minor=price.amount_minor * 2,
            currency="LYD",
            currency_exponent=3,
            installment_amounts_minor=[price.amount_minor, price.amount_minor],
            anchor_at=start,
        )
        payment.installment_agreement = agreement
        payment.installment_number = 1
        payment.save(update_fields=("installment_agreement", "installment_number"))
    payment.refresh_from_db()
    return user, sub, payment, admin, client


def _claim(user, payment, *, kind="voluntary", remedy="refund", phone=""):
    return create_claim(
        user=user,
        actor=user,
        payment_id=payment.id,
        kind=kind,
        remedy=remedy,
        reason="Please process my request",
        receiver_phone=phone,
        idempotency_key=uuid4().hex,
    )[0]


@pytest.mark.parametrize(
    ("days", "installments", "expected"),
    [(9, True, 100), (12, True, 50), (15.1, True, 0), (12, False, 100), (15.1, False, 0)],
)
def test_refund_rates(days, installments, expected):
    _, _, payment, _, _ = _paid(days=days, installments=installments)
    assert voluntary_rate(payment, received_at=timezone.now()) == expected


def test_earlier_installment_purchase_keeps_full_15_day_guarantee():
    _, _, payment, _, _ = _paid(days=12, installments=True, policy="old-policy")
    assert voluntary_rate(payment, received_at=timezone.now()) == 100


def test_activation_requires_approval_and_service_start():
    _, _, payment, _, _ = _paid()
    future = timezone.now() + timedelta(days=3)
    ManualRechargeSubmission.objects.filter(payment=payment).update(
        subscription_period_started_at=future
    )
    payment.refresh_from_db()
    assert activation_at(payment) == future
    ManualRechargeSubmission.objects.filter(payment=payment).update(
        status="pending", reviewed_at=None
    )
    payment.refresh_from_db()
    assert activation_at(payment) is None


def test_claim_records_receipt_without_number_and_preserves_clock_on_contact_update():
    user, _, payment, _, client = _paid()
    body = {"payment_id": str(payment.id), "kind": "voluntary", "reason": "Please refund"}
    first = client.post(
        "/api/v1/refund-requests", body, format="json", HTTP_IDEMPOTENCY_KEY="request-retry-00001"
    )
    replay = client.post(
        "/api/v1/refund-requests", body, format="json", HTTP_IDEMPOTENCY_KEY="request-retry-00001"
    )
    assert first.status_code == 201, first.json()
    assert replay.status_code == 200
    assert first.json()["id"] == replay.json()["id"]
    claim = RefundClaim.objects.get(user=user)
    assert claim.due_at - claim.received_at == timedelta(hours=48)
    before = claim.received_at
    response = client.patch(
        f"/api/v1/refund-requests/{claim.id}", {"receiver_phone": "0912345678"}, format="json"
    )
    assert response.status_code == 200, response.json()
    claim.refresh_from_db()
    assert claim.received_at == before


def test_other_account_cannot_request_or_read_a_purchase():
    _, _, payment, _, _ = _paid()
    other = create_user(email="other-policy@example.com")
    client = APIClient()
    client.force_authenticate(other)
    response = client.post(
        "/api/v1/refund-requests",
        {"payment_id": str(payment.id), "kind": "platform_error", "reason": "Service not provided"},
        format="json",
        HTTP_IDEMPOTENCY_KEY=uuid4().hex,
    )
    assert response.status_code == 404
    assert client.get("/api/v1/operations/admin/refund-requests").status_code == 403


def test_user_cannot_override_original_receipt_or_refund_amount():
    _, _, payment, _, client = _paid()
    response = client.post(
        "/api/v1/refund-requests",
        {
            "payment_id": str(payment.id),
            "kind": "voluntary",
            "reason": "Refund please",
            "received_at": timezone.now().isoformat(),
            "approved_amount_minor": 99999999,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=uuid4().hex,
    )
    assert response.status_code == 400


def test_half_refund_cancels_access_and_installments_and_completes_once():
    user, sub, payment, admin, _ = _paid(days=12, installments=True)
    claim = _claim(user, payment, phone="0912345678")
    claim = review_claim(
        claim_id=claim.id, actor=admin, action="approve", reason="Voluntary refund verified"
    )
    assert claim.approved_amount_minor == payment.amount_minor // 2
    sub.refresh_from_db()
    payment.installment_agreement.refresh_from_db()
    assert sub.status == Subscription.Status.CANCELLED
    assert payment.installment_agreement.status == InstallmentAgreement.Status.CANCELLED
    assert not entitlement_decision(user=user, entitlement_code="focus.workspace").allowed
    for _ in range(2):
        review_claim(
            claim_id=claim.id,
            actor=admin,
            action="complete",
            reason="Net airtime transferred",
            transfer_reference="airtime-actual-transfer-123",
            transferred_to=claim.receiver_phone,
            transferred_amount_minor=claim.approved_amount_minor,
        )
    payment.refresh_from_db()
    assert payment.refunded_amount_minor == payment.amount_minor // 2
    assert Refund.objects.filter(payment=payment, status="succeeded").count() == 1


def test_platform_error_is_reviewable_and_fully_refundable_after_15_days():
    user, _, payment, admin, _ = _paid(days=60)
    claim = _claim(user, payment, kind="platform_error")
    claim = review_claim(
        claim_id=claim.id,
        actor=admin,
        action="approve",
        reason="Platform failed to provide service",
    )
    assert claim.approved_amount_minor == payment.amount_minor


def test_compensation_requires_choice_and_is_revoked_when_service_returns():
    user, _, payment, admin, _ = _paid(days=60)
    claim = _claim(user, payment, kind="platform_error", remedy="extension")
    with pytest.raises(ValueError, match="cannot be approved"):
        review_claim(
            claim_id=claim.id, actor=admin, action="approve", reason="User chose extension"
        )
    review_claim(
        claim_id=claim.id, actor=admin, action="compensate", reason="Confirmed platform outage"
    )
    grants = EntitlementGrant.objects.filter(source_id=claim.id)
    assert grants.exists()
    assert grants.filter(ends_at__isnull=True, status="active").exists()
    review_claim(
        claim_id=claim.id,
        actor=admin,
        action="restore",
        reason="Service restored and user notified",
    )
    assert not grants.filter(status="active").exists()
    assert not Refund.objects.filter(payment=payment).exists()


def test_pending_new_purchase_does_not_add_paid_access_but_preserves_trial():
    user, sub = _trial_user(email="pending-policy@example.com")
    user.policy_version = USER_POLICY_VERSION
    user.policy_accepted_at = timezone.now()
    user.save()
    plan, _ = _monthly_plan_and_price()
    client = APIClient()
    client.force_authenticate(user)
    response = _submit(client, plan=plan, code="1234567890123", key=uuid4().hex)
    assert response.status_code == 201
    # Existing trial access remains bounded by its original end, not the new paid period.
    decision = entitlement_decision(user=user, entitlement_code="focus.workspace")
    assert decision.allowed
    assert decision.expires_at == sub.trial_ends_at


def test_partial_card_collection_remains_refundable_without_granting_access():
    user, _ = _trial_user(email="partial-policy@example.com")
    plan, price = _monthly_plan_and_price()
    client = APIClient()
    client.force_authenticate(user)
    response = _submit(client, plan=plan, code="1234567890123", key=uuid4().hex)
    payment = Payment.objects.get(id=response.json()["payment"]["id"])
    admin = create_user(email="partial-finance@example.com", is_superuser=True)
    review_manual_recharge(
        payment_id=payment.id,
        actor=admin,
        decision="reject",
        reason="Only one card had collectible value",
        idempotency_key=uuid4().hex,
        collected_amount_minor=price.amount_minor // 2,
    )
    payment.refresh_from_db()
    assert payment.amount_minor == price.amount_minor // 2
    assert payment.status == Payment.Status.SUCCEEDED
    claim = _claim(user, payment, kind="payment_error", phone="0912345678")
    claim = review_claim(
        claim_id=claim.id, actor=admin, action="approve", reason="Return all collected value"
    )
    assert claim.approved_amount_minor == price.amount_minor // 2


@override_settings(ACCOUNT_POLICY_VERSION=USER_POLICY_VERSION)
def test_current_policy_acceptance_is_explicit_and_idempotent():
    user = create_user(email="consent-policy@example.com")
    client = APIClient()
    client.force_authenticate(user)
    bad = client.post(
        "/api/v1/account/policies",
        {"version": USER_POLICY_VERSION, "accept_policies": False},
        format="json",
    )
    assert bad.status_code == 400
    for _ in range(2):
        response = client.post(
            "/api/v1/account/policies",
            {"version": USER_POLICY_VERSION, "accept_policies": True},
            format="json",
        )
        assert response.status_code == 200
        user.refresh_from_db()
        assert user.policy_version == USER_POLICY_VERSION
    assert user.policy_accepted_at is not None


def test_moderator_user_details_do_not_reveal_financial_records():
    from apps.administration.models import OperationalRoleAssignment

    user, _, payment, _, _ = _paid()
    moderator = create_user(email="policy-moderator@example.com")
    OperationalRoleAssignment.objects.create(user=moderator, role_id="moderator")
    client = APIClient()
    client.force_authenticate(moderator)
    response = client.get(f"/api/v1/operations/admin/users/{user.id}")
    assert response.status_code == 200, response.json()
    assert response.json()["purchases"] == []
    assert response.json()["refunds"] == []
    assert str(payment.id) not in str(response.json()["purchases"])


def test_recipient_correction_after_approval_preserves_clock_and_prevents_stale_transfer():
    user, _, payment, admin, client = _paid()
    claim = _claim(user, payment, phone="0912345678")
    claim = review_claim(
        claim_id=claim.id, actor=admin, action="approve", reason="Refund reviewed and approved"
    )
    original = claim.received_at
    response = client.patch(
        f"/api/v1/refund-requests/{claim.id}", {"receiver_phone": "0922345678"}, format="json"
    )
    assert response.status_code == 200, response.json()
    with pytest.raises(ValueError, match="actual recipient"):
        review_claim(
            claim_id=claim.id,
            actor=admin,
            action="complete",
            reason="Actual transfer was reviewed",
            transfer_reference="transfer-old-recipient",
            transferred_to="0912345678",
            transferred_amount_minor=claim.approved_amount_minor,
        )
    claim.refresh_from_db()
    payment.refresh_from_db()
    assert claim.received_at == original
    assert payment.refunded_amount_minor == 0


def test_external_request_preserves_its_original_receipt_and_deadline():
    _, _, payment, admin, _ = _paid()
    Payment.objects.filter(id=payment.id).update(created_at=timezone.now() - timedelta(days=2))
    received = timezone.now() - timedelta(hours=3)
    client = APIClient()
    client.force_authenticate(admin)
    response = client.post(
        "/api/v1/operations/admin/refund-requests",
        {
            "payment_id": str(payment.id),
            "kind": "voluntary",
            "reason": "Original Telegram request",
            "channel": "telegram",
            "received_at": received.isoformat(),
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY=uuid4().hex,
    )
    assert response.status_code == 201, response.json()
    claim = RefundClaim.objects.get(id=response.json()["id"])
    assert claim.received_at == received
    assert claim.due_at == received + timedelta(hours=48)


@override_settings(ACCOUNT_POLICY_VERSION=USER_POLICY_VERSION, USER_POLICY_EFFECTIVE_AT="")
def test_new_purchase_waits_for_announced_policy_activation(settings):
    user, _ = _trial_user(email="activation-policy@example.com")
    user.policy_version = USER_POLICY_VERSION
    user.policy_accepted_at = timezone.now()
    user.save()
    client = APIClient()
    client.force_authenticate(user)
    plan, _ = _monthly_plan_and_price()
    refused = _submit(client, plan=plan, code="1234567890123", key=uuid4().hex)
    assert refused.status_code == 400
    assert not Payment.objects.filter(account__primary_user=user).exists()
    settings.USER_POLICY_EFFECTIVE_AT = (timezone.now() - timedelta(minutes=1)).isoformat()
    accepted = _submit(client, plan=plan, code="1234567890123", key=uuid4().hex)
    assert accepted.status_code == 201, accepted.json()


def test_finance_queue_keeps_open_requests_visible_after_closed_history():
    user, _, payment, admin, client = _paid()
    old = timezone.now() - timedelta(days=1)
    RefundClaim.objects.bulk_create(
        [
            RefundClaim(
                user=user,
                payment=payment,
                kind="voluntary",
                reason="Closed earlier request",
                status="completed",
                received_at=old,
                due_at=old + timedelta(hours=48),
                idempotency_key=f"closed-history-{n}",
            )
            for n in range(30)
        ]
    )
    claim = _claim(user, payment)
    finance = APIClient()
    finance.force_authenticate(admin)
    queue = finance.get("/api/v1/operations/admin/refund-requests")
    assert queue.status_code == 200
    assert queue.json()["count"] == 1
    assert queue.json()["results"][0]["id"] == str(claim.id)
    history = finance.get("/api/v1/operations/admin/refund-requests?scope=all")
    assert history.json()["count"] == 31 and history.json()["next"]
    personal = client.get("/api/v1/refund-requests")
    assert personal.json()["results"][0]["id"] == str(claim.id)


def test_delayed_card_approval_preserves_the_agreed_installment_dates():
    from unittest.mock import patch

    from apps.payments.installments import installment_snapshot
    from apps.payments.manual_services import submit_manual_recharge
    from apps.product_catalog.models import Price

    user, _ = _trial_user(email="agreed-schedule@example.com")
    user.policy_version = USER_POLICY_VERSION
    user.policy_accepted_at = timezone.now()
    user.save()
    price = Price.objects.select_related("plan_version").get(code="dentistry_pre_midterm_30_lyd")
    purchase = submit_manual_recharge(
        user=user,
        price=price,
        recharge_codes=["1234567890123"],
        idempotency_key=uuid4().hex,
        pay_in_installments=True,
    )
    agreement = InstallmentAgreement.objects.get(id=purchase.payment.installment_agreement_id)
    agreed_anchor = agreement.anchor_at
    assert installment_snapshot(agreement).state == "in_review"
    second_due = installment_snapshot(agreement).items[1]["due_at"]
    admin = create_user(email="schedule-finance@example.com", is_superuser=True)
    with patch("django.utils.timezone.now", return_value=timezone.now() + timedelta(days=2)):
        review_manual_recharge(
            payment_id=purchase.payment.id,
            actor=admin,
            decision="approve",
            reason="Full card value verified after review",
            idempotency_key=uuid4().hex,
        )
    agreement.refresh_from_db()
    assert agreement.anchor_at == agreed_anchor
    assert installment_snapshot(agreement).items[1]["due_at"] == second_due


def test_agreed_alternative_refund_requires_recorded_user_agreement():
    user, _, payment, admin, _ = _paid()
    claim = _claim(user, payment)
    claim = review_claim(
        claim_id=claim.id,
        actor=admin,
        action="approve",
        reason="Refund amount reviewed and approved",
    )
    with pytest.raises(ValueError, match="agreement"):
        review_claim(
            claim_id=claim.id,
            actor=admin,
            action="complete",
            reason="Airtime transfer unavailable",
            agreed_alternative=True,
            transferred_to="agreed-beneficiary-reference",
            transferred_amount_minor=claim.approved_amount_minor,
            transfer_reference="actual-transfer-123",
        )
    result = review_claim(
        claim_id=claim.id,
        actor=admin,
        action="complete",
        reason="Refund sent by agreed alternative",
        agreed_alternative=True,
        alternative_agreement_reference="support-thread-user-agreement-123",
        transferred_to="agreed-beneficiary-reference",
        transferred_amount_minor=claim.approved_amount_minor,
        transfer_reference="actual-transfer-123",
    )
    assert result.status == "completed"
    assert result.transfer_details["channel"] == "agreed_alternative"
    assert result.transfer_details["net_amount_minor"] == claim.approved_amount_minor


def test_partial_rejected_installment_does_not_count_as_paid_or_refund_prior_installments():
    from apps.payments.installments import installment_snapshot
    from apps.payments.manual_services import ManualPaymentError, submit_installment_payment

    user, sub, first, admin, _ = _paid(days=35, installments=True)
    agreement = first.installment_agreement
    second = submit_installment_payment(
        user=user,
        agreement_id=agreement.id,
        recharge_codes=["3333444455556"],
        idempotency_key=uuid4().hex,
    ).payment
    review_manual_recharge(
        payment_id=second.id,
        actor=admin,
        decision="reject",
        reason="Only partial card value collected",
        idempotency_key=uuid4().hex,
        collected_amount_minor=second.amount_minor // 2,
    )
    sub.refresh_from_db()
    second.refresh_from_db()
    snapshot = installment_snapshot(agreement)
    assert snapshot.next_number == 2
    assert snapshot.paid_minor == first.amount_minor
    assert sub.status == "suspended"
    with pytest.raises(ManualPaymentError, match="partially collected"):
        submit_installment_payment(
            user=user,
            agreement_id=agreement.id,
            recharge_codes=["3333444455557"],
            idempotency_key=uuid4().hex,
        )
    claim = _claim(user, second, kind="payment_error", phone="0912345678")
    assert claim.payment_id == second.id
    claim = review_claim(
        claim_id=claim.id,
        actor=admin,
        action="approve",
        reason="Refund only this failed installment collection",
    )
    assert claim.approved_amount_minor == second.amount_minor
    agreement.refresh_from_db()
    assert agreement.status == "active"
    review_claim(
        claim_id=claim.id,
        actor=admin,
        action="complete",
        reason="Actual net value sent back to student",
        transfer_reference="partial-installment-airtime-123",
        transferred_to=claim.receiver_phone,
        transferred_amount_minor=claim.approved_amount_minor,
    )
    first.refresh_from_db()
    assert first.refunded_amount_minor == 0
    retry = submit_installment_payment(
        user=user,
        agreement_id=agreement.id,
        recharge_codes=["3333444455558"],
        idempotency_key=uuid4().hex,
    ).payment
    assert retry.installment_number == 2

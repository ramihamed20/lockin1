"""End-to-end parity between a manual payment decision and what the reader sees.

Every test here starts from the API the browser actually calls and ends at the
API the browser actually reads, because the failures this module exists to
prevent all lived in the gap between those two: a payment that settled while the
subscription, the entitlement grant or the subscription snapshot kept saying
something else.
"""

import base64
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.entitlements.services import entitlement_decision
from apps.payments.manual_services import ManualPaymentError, review_manual_recharge
from apps.payments.models import ManualRechargeSubmission, Payment
from apps.product_catalog.models import Plan, Price
from apps.subscriptions.models import Subscription, SubscriptionTransition
from apps.subscriptions.services import create_trial_for_user

pytestmark = pytest.mark.django_db

STUDY_ENTITLEMENT = "content.premium"


@pytest.fixture(autouse=True)
def manual_payment_settings(settings):  # type: ignore[no-untyped-def]
    settings.PAYMENT_CODE_ENCRYPTION_KEY = base64.urlsafe_b64encode(b"a" * 32).decode()
    settings.TELEGRAM_BOT_TOKEN = ""
    settings.TELEGRAM_PAYMENT_CHAT_ID = ""


def _monthly_plan() -> tuple[Plan, Price]:
    plan = Plan.objects.select_related("current_version").get(code="lockin_monthly")
    price = Price.objects.get(
        plan_version_id=plan.current_version_id, currency="LYD", status=Price.Status.ACTIVE
    )
    return plan, price


def _reader(email: str, *, with_trial: bool = True):
    username = email.split("@", maxsplit=1)[0].replace("-", "_")[:30]
    user = create_user(email=email, username=username)
    if with_trial:
        create_trial_for_user(user=user, source_reference="lifecycle-test")
    client = APIClient()
    client.force_authenticate(user)
    return user, client


def _reviewer(email: str = "reviewer@example.com"):
    return create_user(email=email, username=email.split("@", maxsplit=1)[0].replace("-", "_")[:30])


def _submit(client: APIClient, plan: Plan, code: str, key: str):
    return client.post(
        "/api/v1/payments/manual-libyana",
        {"plan_id": str(plan.id), "recharge_codes": [code]},
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
    )


def _snapshot(client: APIClient) -> dict:
    response = client.get("/api/v1/subscriptions/current")
    assert response.status_code == 200
    return response.json()["subscription"]


def _expire_trial(subscription: Subscription, *, days_ago: int) -> None:
    """Move a running trial wholly into the past without touching its history.

    This is what the passage of time does to a trial; it is not what any code
    path does, which is precisely why it belongs in the fixture rather than in
    the assertions.
    """

    ended = timezone.now() - timedelta(days=days_ago)
    Subscription.objects.filter(id=subscription.id).update(
        trial_started_at=ended - timedelta(days=7),
        trial_ends_at=ended,
        current_period_started_at=ended - timedelta(days=7),
        current_period_ends_at=ended,
        grace_ends_at=ended,
    )


# --------------------------------------------------------------------------
# Free trial
# --------------------------------------------------------------------------


def test_trial_grants_exactly_seven_days_from_verification() -> None:
    user = create_user(email="trial-length@example.com", username="trial_length")
    subscription, created = create_trial_for_user(user=user, source_reference="test")

    assert created is True
    assert subscription.status == Subscription.Status.TRIALING
    assert subscription.trial_ends_at - subscription.trial_started_at == timedelta(days=7)
    assert subscription.trial_started_at == user.email_verified_at
    assert entitlement_decision(user=user, entitlement_code=STUDY_ENTITLEMENT).allowed is True


def test_trial_cannot_be_claimed_twice_by_repeated_calls() -> None:
    user = create_user(email="trial-once@example.com", username="trial_once")
    first, created_first = create_trial_for_user(user=user, source_reference="verification")

    repeats = [
        create_trial_for_user(user=user, source_reference=reference)
        for reference in ("oauth-reconnect", "reconciliation", "verification-resend")
    ]

    assert created_first is True
    assert all(created is False for _, created in repeats)
    assert {subscription.id for subscription, _ in repeats} == {first.id}
    assert {subscription.trial_ends_at for subscription, _ in repeats} == {first.trial_ends_at}
    assert Subscription.objects.filter(account__primary_user=user).count() == 1


def test_trial_survives_repeated_reads_and_expires_exactly_once() -> None:
    user, client = _reader("trial-expiry@example.com")
    subscription = Subscription.objects.get(account__primary_user=user)

    for _ in range(3):
        assert _snapshot(client)["status"] == Subscription.Status.TRIALING

    _expire_trial(subscription, days_ago=1)

    expired = _snapshot(client)
    assert expired["status"] == Subscription.Status.EXPIRED
    assert expired["access_allowed"] is False
    assert entitlement_decision(user=user, entitlement_code=STUDY_ENTITLEMENT).allowed is False
    # Reading again must not mint a second expiry, nor restart anything.
    assert _snapshot(client)["status"] == Subscription.Status.EXPIRED
    assert (
        SubscriptionTransition.objects.filter(
            subscription=subscription, reason_code="trial_ended"
        ).count()
        == 1
    )


# --------------------------------------------------------------------------
# Approval
# --------------------------------------------------------------------------


def test_approval_settles_payment_subscription_and_entitlement_together() -> None:
    user, client = _reader("approve@example.com")
    plan, _ = _monthly_plan()
    payment_id = _submit(client, plan, "1234567890123", "approve-attempt-0001").json()["payment"][
        "id"
    ]

    pending = _snapshot(client)
    assert pending["payment_verification"] == "provisional"
    assert pending["manual_payment_review"]["status"] == "pending"

    submission, changed = review_manual_recharge(
        payment_id=payment_id,
        actor=_reviewer(),
        decision="approve",
        reason="Card verified with the operator.",
        idempotency_key="approve-review-000001",
    )

    assert changed is True
    assert submission.status == ManualRechargeSubmission.Status.APPROVED
    assert Payment.objects.get(id=payment_id).status == Payment.Status.SUCCEEDED

    approved = _snapshot(client)
    assert approved["status"] == Subscription.Status.ACTIVE
    assert approved["payment_verification"] == "verified"
    assert approved["access_allowed"] is True
    assert approved["manual_payment_review"]["status"] == "approved"
    assert approved["manual_payment_review"]["reviewed_at"] is not None
    assert entitlement_decision(user=user, entitlement_code=STUDY_ENTITLEMENT).allowed is True
    assert SubscriptionTransition.objects.filter(
        subscription_id=approved["id"], reason_code="manual_payment_approved"
    ).exists()


def test_approving_twice_does_not_extend_the_subscription_again() -> None:
    _, client = _reader("approve-twice@example.com")
    plan, _ = _monthly_plan()
    payment_id = _submit(client, plan, "1234567890123", "approve-twice-0001").json()["payment"][
        "id"
    ]
    reviewer = _reviewer()

    review_manual_recharge(
        payment_id=payment_id,
        actor=reviewer,
        decision="approve",
        reason="First decision.",
        idempotency_key="approve-twice-review-1",
    )
    after_first = _snapshot(client)

    _, changed_again = review_manual_recharge(
        payment_id=payment_id,
        actor=reviewer,
        decision="approve",
        reason="Second decision, different key.",
        idempotency_key="approve-twice-review-2",
    )
    after_second = _snapshot(client)

    assert changed_again is False
    assert after_second["current_period_ends_at"] == after_first["current_period_ends_at"]
    assert after_second["revision"] == after_first["revision"]
    assert (
        SubscriptionTransition.objects.filter(
            subscription_id=after_first["id"], reason_code="manual_payment_approved"
        ).count()
        == 1
    )


def test_rejecting_an_approved_payment_is_refused() -> None:
    _, client = _reader("approve-then-reject@example.com")
    plan, _ = _monthly_plan()
    payment_id = _submit(client, plan, "1234567890123", "approve-reject-0001").json()["payment"][
        "id"
    ]
    reviewer = _reviewer()
    review_manual_recharge(
        payment_id=payment_id,
        actor=reviewer,
        decision="approve",
        reason="Card verified.",
        idempotency_key="approve-reject-review-1",
    )

    with pytest.raises(ManualPaymentError):
        review_manual_recharge(
            payment_id=payment_id,
            actor=reviewer,
            decision="reject",
            reason="Changed my mind.",
            idempotency_key="approve-reject-review-2",
        )

    assert Payment.objects.get(id=payment_id).status == Payment.Status.SUCCEEDED
    assert _snapshot(client)["access_allowed"] is True


# --------------------------------------------------------------------------
# Rejection
# --------------------------------------------------------------------------


def test_rejection_removes_provisional_access_and_reopens_payment() -> None:
    user, client = _reader("reject@example.com")
    subscription = Subscription.objects.get(account__primary_user=user)
    _expire_trial(subscription, days_ago=2)
    assert _snapshot(client)["access_allowed"] is False

    plan, _ = _monthly_plan()
    payment_id = _submit(client, plan, "1234567890123", "reject-attempt-0001").json()["payment"][
        "id"
    ]
    assert _snapshot(client)["access_allowed"] is True

    submission, changed = review_manual_recharge(
        payment_id=payment_id,
        actor=_reviewer(),
        decision="reject",
        reason="The card number was already spent.",
        idempotency_key="reject-review-000001",
    )

    assert changed is True
    assert submission.status == ManualRechargeSubmission.Status.REJECTED
    assert Payment.objects.get(id=payment_id).status == Payment.Status.FAILED

    rejected = _snapshot(client)
    assert rejected["access_allowed"] is False
    assert rejected["payment_verification"] == "verified"
    assert rejected["manual_payment_review"]["status"] == "rejected"
    assert rejected["manual_payment_review"]["rejection_reason"]
    assert entitlement_decision(user=user, entitlement_code=STUDY_ENTITLEMENT).allowed is False

    # The reader is not locked out of paying again.
    retry = _submit(client, plan, "1234567890124", "reject-attempt-0002")
    assert retry.status_code == 201
    assert _snapshot(client)["manual_payment_review"]["status"] == "pending"


def test_rejection_does_not_leave_a_lapsed_trial_reported_as_running() -> None:
    """The stuck state: a card submitted on trial and reviewed after it ended.

    The rejection restores the snapshot taken at submission -- a running trial --
    and writes its own transition at the moment of review. The trial-end
    reconciliation that has to follow is therefore *older* than the transition
    just written, and used to be discarded as out of order, permanently: the
    subscription stayed TRIALING with a trial end in the past, so the study gate
    denied it while the subscription screen called it a live trial.
    """

    user, client = _reader("reject-late@example.com")
    subscription = Subscription.objects.get(account__primary_user=user)
    plan, _ = _monthly_plan()
    payment_id = _submit(client, plan, "1234567890123", "reject-late-00001").json()["payment"]["id"]

    # The card sits in the queue until after the trial would have ended.
    submission = ManualRechargeSubmission.objects.get(payment_id=payment_id)
    lapsed = submission.previous_subscription_state
    trial_start = (timezone.now() - timedelta(days=9)).isoformat()
    trial_end = (timezone.now() - timedelta(days=2)).isoformat()
    lapsed["trial_started_at"] = trial_start
    lapsed["started_at"] = trial_start
    lapsed["current_period_started_at"] = trial_start
    lapsed["trial_ends_at"] = trial_end
    lapsed["current_period_ends_at"] = trial_end
    lapsed["grace_ends_at"] = trial_end
    ManualRechargeSubmission.objects.filter(id=submission.id).update(
        previous_subscription_state=lapsed
    )

    review_manual_recharge(
        payment_id=payment_id,
        actor=_reviewer(),
        decision="reject",
        reason="The card was not valid.",
        idempotency_key="reject-late-review-01",
    )

    settled = _snapshot(client)
    assert settled["status"] == Subscription.Status.EXPIRED
    assert settled["access_allowed"] is False
    assert entitlement_decision(user=user, entitlement_code=STUDY_ENTITLEMENT).allowed is False
    assert Subscription.objects.get(id=subscription.id).status == Subscription.Status.EXPIRED


def test_rejecting_twice_is_a_no_op() -> None:
    user, client = _reader("reject-twice@example.com")
    _expire_trial(Subscription.objects.get(account__primary_user=user), days_ago=2)
    plan, _ = _monthly_plan()
    payment_id = _submit(client, plan, "1234567890123", "reject-twice-00001").json()["payment"][
        "id"
    ]
    reviewer = _reviewer()

    review_manual_recharge(
        payment_id=payment_id,
        actor=reviewer,
        decision="reject",
        reason="Not a valid card.",
        idempotency_key="reject-twice-review1",
    )
    after_first = _snapshot(client)

    _, changed_again = review_manual_recharge(
        payment_id=payment_id,
        actor=reviewer,
        decision="reject",
        reason="Still not a valid card.",
        idempotency_key="reject-twice-review2",
    )
    after_second = _snapshot(client)

    assert changed_again is False
    assert after_second["status"] == after_first["status"]
    assert after_second["revision"] == after_first["revision"]
    assert after_second["access_allowed"] is False


def test_approving_a_rejected_payment_is_refused() -> None:
    user, client = _reader("reject-then-approve@example.com")
    _expire_trial(Subscription.objects.get(account__primary_user=user), days_ago=2)
    plan, _ = _monthly_plan()
    payment_id = _submit(client, plan, "1234567890123", "reject-approve-0001").json()["payment"][
        "id"
    ]
    reviewer = _reviewer()
    review_manual_recharge(
        payment_id=payment_id,
        actor=reviewer,
        decision="reject",
        reason="Rejected in review.",
        idempotency_key="reject-approve-rev1",
    )

    with pytest.raises(ManualPaymentError):
        review_manual_recharge(
            payment_id=payment_id,
            actor=reviewer,
            decision="approve",
            reason="Reconsidered.",
            idempotency_key="reject-approve-rev2",
        )

    assert Payment.objects.get(id=payment_id).status == Payment.Status.FAILED
    assert _snapshot(client)["access_allowed"] is False


# --------------------------------------------------------------------------
# Snapshot consistency and persistence
# --------------------------------------------------------------------------


def test_settled_state_survives_a_new_session_on_another_device() -> None:
    user, client = _reader("persistence@example.com")
    plan, _ = _monthly_plan()
    payment_id = _submit(client, plan, "1234567890123", "persistence-000001").json()["payment"][
        "id"
    ]
    review_manual_recharge(
        payment_id=payment_id,
        actor=_reviewer(),
        decision="approve",
        reason="Card verified.",
        idempotency_key="persistence-review1",
    )

    other_device = APIClient()
    other_device.force_authenticate(user)
    elsewhere = _snapshot(other_device)

    assert elsewhere["status"] == Subscription.Status.ACTIVE
    assert elsewhere["payment_verification"] == "verified"
    assert elsewhere["access_allowed"] is True
    assert elsewhere["manual_payment_review"]["status"] == "approved"
    assert (
        other_device.get("/api/v1/entitlements/me").json()["results"]
        == client.get("/api/v1/entitlements/me").json()["results"]
    )


def test_a_reader_without_a_subscription_row_can_still_pay() -> None:
    """No trial row is not a reason to refuse money.

    A reader verified before the trial plan was published has no subscription,
    and the only screen that could have fixed that was the one refusing their
    card with "try again".
    """

    user, client = _reader("no-subscription@example.com", with_trial=False)
    assert Subscription.objects.filter(account__primary_user=user).exists() is False
    plan, _ = _monthly_plan()

    response = _submit(client, plan, "1234567890123", "no-subscription-0001")

    assert response.status_code == 201
    opened = _snapshot(client)
    assert opened["status"] == Subscription.Status.ACTIVE
    assert opened["payment_verification"] == "provisional"
    assert opened["access_allowed"] is True


def test_a_rejection_does_not_undo_an_administrator_who_moved_on() -> None:
    """A stale snapshot must never overwrite a later, better-informed decision.

    Between submission and review, an administrator can extend the period,
    suspend the account, or settle it some other way. The rejection still has to
    settle the payment -- but restoring the subscription as it looked before the
    card was submitted would silently revert whatever they did.
    """

    user, client = _reader("reject-after-admin@example.com")
    plan, _ = _monthly_plan()
    payment_id = _submit(client, plan, "1234567890123", "reject-admin-00001").json()["payment"]["id"]
    subscription = Subscription.objects.get(account__primary_user=user)

    # An administrator grants a longer period while the card is queued.
    extended = timezone.now() + timedelta(days=90)
    Subscription.objects.filter(id=subscription.id).update(
        current_period_ends_at=extended, grace_ends_at=extended
    )

    review_manual_recharge(
        payment_id=payment_id,
        actor=_reviewer(),
        decision="reject",
        reason="The card itself was not valid.",
        idempotency_key="reject-admin-review1",
    )

    settled = Subscription.objects.get(id=subscription.id)
    assert Payment.objects.get(id=payment_id).status == Payment.Status.FAILED
    assert settled.current_period_ends_at == extended
    # The provisional marker still clears: nothing is left waiting on a payment
    # that has already been decided.
    assert settled.payment_verification == Subscription.PaymentVerification.VERIFIED
    assert settled.provisional_payment_id is None
    assert _snapshot(client)["access_allowed"] is True


def test_a_second_submission_is_refused_while_one_is_pending() -> None:
    user, client = _reader("one-pending@example.com")
    plan, _ = _monthly_plan()
    assert _submit(client, plan, "1234567890123", "one-pending-000001").status_code == 201

    second = _submit(client, plan, "1234567890124", "one-pending-000002")

    assert second.status_code == 400
    assert ManualRechargeSubmission.objects.filter(user=user).count() == 1


def test_retrying_the_same_attempt_key_returns_the_same_payment() -> None:
    _, client = _reader("retry-key@example.com")
    plan, _ = _monthly_plan()

    first = _submit(client, plan, "1234567890123", "retry-attempt-00001")
    retry = _submit(client, plan, "1234567890123", "retry-attempt-00001")

    assert first.status_code == 201
    assert retry.status_code == 200
    assert retry.json()["payment"]["id"] == first.json()["payment"]["id"]
    assert Payment.objects.filter(id=first.json()["payment"]["id"]).count() == 1


def test_access_continues_through_the_grace_window_before_reconciliation_runs() -> None:
    user, client = _reader("grace@example.com")
    plan, _ = _monthly_plan()
    payment_id = _submit(client, plan, "1234567890123", "grace-attempt-00001").json()["payment"][
        "id"
    ]
    review_manual_recharge(
        payment_id=payment_id,
        actor=_reviewer(),
        decision="approve",
        reason="Card verified.",
        idempotency_key="grace-review-000001",
    )
    subscription = Subscription.objects.get(account__primary_user=user)

    # The paid period ended an hour ago; the lifecycle job has not run yet.
    Subscription.objects.filter(id=subscription.id).update(
        current_period_started_at=timezone.now() - timedelta(days=31),
        current_period_ends_at=timezone.now() - timedelta(hours=1),
        grace_ends_at=timezone.now() + timedelta(days=6),
    )

    assert entitlement_decision(user=user, entitlement_code=STUDY_ENTITLEMENT).allowed is True
    assert _snapshot(client)["status"] == Subscription.Status.GRACE

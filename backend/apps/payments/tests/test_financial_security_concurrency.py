from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event, Lock
from time import monotonic, sleep

import pytest
from django.db import close_old_connections, connection
from django.utils import timezone

from apps.accounts.tests.helpers import create_user
from apps.audit.models import AuditRecord
from apps.entitlements.models import (
    EntitlementDefinition,
    EntitlementGrant,
    EntitlementGrantAudit,
    PlanEntitlementRule,
)
from apps.entitlements.services import entitlement_decision
from apps.invoices.models import Invoice
from apps.notifications.models import Notification
from apps.payments.manual_services import review_manual_recharge, submit_manual_recharge
from apps.payments.models import ManualRechargeSubmission, Payment, PaymentTransition
from apps.product_catalog.models import Plan, PlanVersion, Price, Product
from apps.subscriptions.models import Subscription, SubscriptionTransition
from apps.subscriptions.services import (
    create_pending_subscription,
    create_trial_for_user,
    get_or_create_individual_account,
    transition_subscription,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]


@pytest.fixture
def financial_catalog(settings):
    # Transaction tests flush seed migrations. Own all data rather than relying
    # on suite order or restoring the global serialized database snapshot.
    product = Product.objects.create(
        code="security-financial-product", title="Security fixture", status=Product.Status.ACTIVE
    )
    plan = Plan.objects.create(
        product=product, code="security-financial-plan", status=Plan.Status.ACTIVE
    )
    version = PlanVersion.objects.create(
        plan=plan, version=1, title="Security fixture", trial_days=7, grace_days=3
    )
    plan.current_version = version
    plan.save(update_fields=("current_version",))
    definition, _ = EntitlementDefinition.objects.get_or_create(
        code="content.premium", defaults={"title": "Premium access"}
    )
    PlanEntitlementRule.objects.create(plan_version=version, entitlement=definition)
    price = Price.objects.create(
        plan_version=version,
        code="security-financial-price",
        amount_minor=1000,
        currency="LYD",
        interval=Price.Interval.MONTH,
        status=Price.Status.ACTIVE,
    )
    settings.DEFAULT_TRIAL_PLAN_CODE = plan.code
    return plan, price


def _overlap_locked_operations(table, operation):
    """Hold the first real row lock until PostgreSQL proves the other connection waits."""
    assert connection.vendor == "postgresql"
    start = Barrier(2)
    locked = Event()
    release = Event()
    guard = Lock()
    backend_ids = []

    def run(index):
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                backend_id = cursor.fetchone()[0]
            with guard:
                backend_ids.append(backend_id)
            start.wait(timeout=10)

            def pause_first_lock(execute, sql, params, many, context):
                result = execute(sql, params, many, context)
                if sql.startswith("SELECT") and f'FROM "{table}"' in sql and "FOR UPDATE" in sql:
                    with guard:
                        first = not locked.is_set()
                        locked.set()
                    if first:
                        assert release.wait(timeout=15)
                return result

            with connection.execute_wrapper(pause_first_lock):
                return operation(index)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run, index) for index in range(2)]
        try:
            assert locked.wait(timeout=10), "The operation never acquired its expected row lock"
            assert len(set(backend_ids)) == 2
            deadline = monotonic() + 10
            while True:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT pid FROM pg_stat_activity "
                        "WHERE pid = ANY(%s) AND cardinality(pg_blocking_pids(pid)) > 0",
                        [backend_ids],
                    )
                    waiting = cursor.fetchall()
                if waiting:
                    break
                assert monotonic() < deadline, "The second connection never waited on the row lock"
                sleep(0.02)
        finally:
            release.set()
        return [future.result(timeout=20) for future in futures]


@pytest.mark.parametrize("same_key", [True, False])
def test_parallel_manual_approvals_settle_once_without_extending_access(
    settings, same_key, financial_catalog
) -> None:
    settings.PAYMENT_CODE_ENCRYPTION_KEY = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="
    settings.TELEGRAM_BOT_TOKEN = ""
    settings.TELEGRAM_PAYMENT_CHAT_ID = ""
    user = create_user(email="parallel-financial-reader@example.test")
    reviewer = create_user(email="parallel-financial-reviewer@example.test")
    create_trial_for_user(user=user)
    _, price = financial_catalog
    result = submit_manual_recharge(
        user=user,
        price=price,
        recharge_codes=["1234567890123"],
        idempotency_key="parallel-financial-submission-001",
    )
    reserved_end = result.subscription.current_period_ends_at
    revision = result.subscription.revision

    def approve(index):
        submission, changed = review_manual_recharge(
            payment_id=result.payment.id,
            actor=reviewer,
            decision="approve",
            reason="Synthetic concurrent card approval.",
            idempotency_key=f"parallel-financial-review-{0 if same_key else index}-001",
            send_notification=False,
        )
        return changed, submission.status

    outcomes = _overlap_locked_operations("payments_manualrechargesubmission", approve)
    assert sorted(changed for changed, _ in outcomes) == [False, True]
    assert {status for _, status in outcomes} == {ManualRechargeSubmission.Status.APPROVED}
    result.payment.refresh_from_db()
    result.subscription.refresh_from_db()
    assert result.payment.status == Payment.Status.SUCCEEDED
    assert result.subscription.status == Subscription.Status.ACTIVE
    assert result.subscription.payment_verification == Subscription.PaymentVerification.VERIFIED
    assert result.subscription.provisional_payment_id is None
    assert result.subscription.current_period_ends_at == reserved_end
    assert result.subscription.revision == revision + 1
    assert (
        PaymentTransition.objects.filter(
            payment=result.payment, reason_code="manual_payment_approved"
        ).count()
        == 1
    )
    assert (
        SubscriptionTransition.objects.filter(
            subscription=result.subscription, reason_code="manual_payment_approved"
        ).count()
        == 1
    )
    invoice = Invoice.objects.get(payment=result.payment)
    assert invoice.status == Invoice.Status.PAID
    assert invoice.amount_paid_minor == result.payment.amount_minor
    assert (
        Notification.objects.filter(
            recipient=user, template_key="billing.manual_payment.approved"
        ).count()
        == 1
    )
    assert (
        AuditRecord.objects.filter(
            action="payment_approved", target_id=str(result.submission.id)
        ).count()
        == 1
    )
    assert entitlement_decision(user=user, entitlement_code="content.premium").allowed


def test_parallel_activation_replays_create_one_transition_and_one_grant_per_rule(
    financial_catalog,
) -> None:
    user = create_user(email="parallel-activation@example.test")
    account = get_or_create_individual_account(user=user)
    plan, _ = financial_catalog
    subscription, _ = create_pending_subscription(
        account=account, plan_version=plan.current_version, idempotency_key="parallel-checkout-001"
    )
    start = timezone.now()
    end = start + timedelta(days=30)
    revision = subscription.revision

    def activate(_):
        return transition_subscription(
            subscription_id=subscription.id,
            to_status=Subscription.Status.ACTIVE,
            reason_code="payment_succeeded",
            source=SubscriptionTransition.Source.SYSTEM,
            effective_at=start,
            idempotency_key="parallel-activation-event-001",
            period_started_at=start,
            period_ends_at=end,
        ).changed

    outcomes = _overlap_locked_operations("subscriptions_subscription", activate)
    assert sorted(outcomes) == [False, True]
    subscription.refresh_from_db()
    assert subscription.status == Subscription.Status.ACTIVE
    assert subscription.revision == revision + 1
    assert subscription.current_period_started_at == start
    assert subscription.current_period_ends_at == end
    assert (
        SubscriptionTransition.objects.filter(
            subscription=subscription, idempotency_key="parallel-activation-event-001"
        ).count()
        == 1
    )
    grants = EntitlementGrant.objects.filter(
        user=user, source_type=EntitlementGrant.SourceType.SUBSCRIPTION, source_id=subscription.id
    )
    rule_count = plan.current_version.entitlement_rules.filter(entitlement__is_active=True).count()
    assert rule_count > 0
    assert grants.count() == rule_count
    assert grants.filter(status=EntitlementGrant.Status.ACTIVE).count() == rule_count
    assert (
        EntitlementGrantAudit.objects.filter(
            grant__in=grants, action=EntitlementGrantAudit.Action.GRANTED
        ).count()
        == rule_count
    )
    assert entitlement_decision(user=user, entitlement_code="content.premium").allowed

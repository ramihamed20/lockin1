import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from apps.accounts.tests.helpers import create_user
from apps.product_catalog.models import Plan, PlanVersion, Price, Product
from apps.subscriptions.models import Subscription, SubscriptionAccount


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_revenue_index_upgrade_preserves_existing_payments_and_is_reversible() -> None:
    old = ("payments", "0006_telegrampaymentoperator")
    new = ("payments", "0007_payment_revenue_time_index")
    # Later payments migrations add columns, so rows are written and read
    # through the model as it looked at each historical migration state.
    state = MigrationExecutor(connection).migrate([old])
    try:
        # Own fixtures: this upgrade test must also work after transaction tests
        # have flushed the migration seeds. No serialized global-data replay.
        product = Product.objects.create(code="migration-audit", title="Synthetic product")
        plan = Plan.objects.create(product=product, code="migration-audit")
        version = PlanVersion.objects.create(plan=plan, version=1, title="Synthetic plan")
        price = Price.objects.create(
            plan_version=version,
            code="migration-audit",
            amount_minor=1000,
            currency="LYD",
            interval=Price.Interval.MONTH,
        )
        account = SubscriptionAccount.objects.create(
            primary_user=create_user(email="migration-audit@example.test"),
            kind=SubscriptionAccount.Kind.INDIVIDUAL,
            display_name="Synthetic upgrade account",
        )
        subscription = Subscription.objects.create(
            account=account,
            plan_version=version,
            status=Subscription.Status.PENDING,
        )
        payment_model = state.apps.get_model("payments", "Payment")
        payment = payment_model.objects.create(
            account_id=account.pk,
            subscription_id=subscription.pk,
            price_id=price.pk,
            amount_minor=price.amount_minor,
            currency=price.currency,
            method="libyana",
            idempotency_key="migration-audit",
            price_snapshot={},
            initiated_at=timezone.now(),
        )
        before = payment_model.objects.filter(pk=payment.pk).values().get()
        state = MigrationExecutor(connection).migrate([new])
        payment_model = state.apps.get_model("payments", "Payment")
        assert payment_model.objects.filter(pk=payment.pk).values().get() == before
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT indisvalid, pg_get_expr(indpred, indrelid) "
                "FROM pg_index WHERE indexrelid = 'payment_revenue_time_idx'::regclass"
            )
            valid, predicate = cursor.fetchone()
        assert valid
        assert all(
            status in predicate for status in ("succeeded", "partially_refunded", "refunded")
        )
        state = MigrationExecutor(connection).migrate([old])
        payment_model = state.apps.get_model("payments", "Payment")
        assert payment_model.objects.filter(pk=payment.pk).values().get() == before
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

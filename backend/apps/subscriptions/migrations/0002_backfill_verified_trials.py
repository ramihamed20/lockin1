from datetime import timedelta

from django.db import migrations
from django.utils import timezone


def backfill_verified_trials(apps, schema_editor):  # type: ignore[no-untyped-def]
    User = apps.get_model("accounts", "User")
    Plan = apps.get_model("product_catalog", "Plan")
    Account = apps.get_model("subscriptions", "SubscriptionAccount")
    Subscription = apps.get_model("subscriptions", "Subscription")
    Transition = apps.get_model("subscriptions", "SubscriptionTransition")
    plan = Plan.objects.select_related("current_version").get(code="lockin_trial")
    version = plan.current_version
    for user in User.objects.filter(
        is_active=True, status="active", email_verified_at__isnull=False
    ).iterator(chunk_size=500):
        account, _ = Account.objects.get_or_create(
            kind="individual",
            primary_user=user,
            defaults={"display_name": user.full_name or user.email, "status": "active"},
        )
        if Subscription.objects.filter(account=account).exists():
            continue
        start = user.email_verified_at
        end = start + timedelta(days=version.trial_days)
        status = "trialing" if end > timezone.now() else "expired"
        subscription = Subscription.objects.create(
            account=account,
            plan_version=version,
            status=status,
            started_at=start,
            trial_started_at=start,
            trial_ends_at=end,
            current_period_started_at=start,
            current_period_ends_at=end,
            status_reason="trial_started",
            ended_at=end if status == "expired" else None,
        )
        Transition.objects.create(
            subscription=subscription,
            from_status="",
            to_status=status,
            source="system",
            reason_code="trial_started" if status == "trialing" else "trial_already_ended",
            source_reference="phase8-migration",
            idempotency_key=f"trial:{user.id}",
            effective_at=start,
        )


class Migration(migrations.Migration):
    dependencies = [
        ("product_catalog", "0002_seed_trial_catalog"),
        ("subscriptions", "0001_initial"),
    ]

    operations = [migrations.RunPython(backfill_verified_trials, migrations.RunPython.noop)]

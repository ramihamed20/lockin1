from django.db import migrations


def backfill_subscription_grants(apps, schema_editor):  # type: ignore[no-untyped-def]
    Subscription = apps.get_model("subscriptions", "Subscription")
    Rule = apps.get_model("entitlements", "PlanEntitlementRule")
    Grant = apps.get_model("entitlements", "EntitlementGrant")
    Audit = apps.get_model("entitlements", "EntitlementGrantAudit")
    active_statuses = ("trialing", "active", "grace")
    subscriptions = Subscription.objects.select_related("account").filter(status__in=active_statuses)
    for subscription in subscriptions.iterator(chunk_size=500):
        user_id = subscription.account.primary_user_id
        if user_id is None:
            continue
        starts_at = (
            subscription.current_period_started_at
            or subscription.trial_started_at
            or subscription.started_at
            or subscription.created_at
        )
        if subscription.status == "trialing":
            ends_at = subscription.trial_ends_at
        elif subscription.status == "grace":
            ends_at = subscription.grace_ends_at
        else:
            ends_at = subscription.grace_ends_at or subscription.current_period_ends_at
        for rule in Rule.objects.filter(plan_version_id=subscription.plan_version_id):
            grant, created = Grant.objects.get_or_create(
                user_id=user_id,
                entitlement_id=rule.entitlement_id,
                source_type="subscription",
                source_id=subscription.id,
                defaults={
                    "status": "active",
                    "starts_at": starts_at,
                    "ends_at": ends_at,
                    "quantity_limit": rule.quantity_limit,
                    "configuration": rule.configuration,
                },
            )
            if created:
                Audit.objects.create(
                    grant=grant,
                    action="granted",
                    reason_code="phase8_migration",
                    source_reference=str(subscription.id),
                    snapshot={
                        "status": "active",
                        "starts_at": starts_at.isoformat(),
                        "ends_at": ends_at.isoformat() if ends_at else None,
                        "quantity_limit": rule.quantity_limit,
                        "configuration": rule.configuration,
                        "revision": 1,
                    },
                )


class Migration(migrations.Migration):
    dependencies = [
        ("entitlements", "0002_seed_entitlement_catalog"),
        ("subscriptions", "0002_backfill_verified_trials"),
    ]

    operations = [migrations.RunPython(backfill_subscription_grants, migrations.RunPython.noop)]

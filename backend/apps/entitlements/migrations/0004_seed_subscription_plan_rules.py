from django.db import migrations


def seed_subscription_rules(apps, schema_editor):  # type: ignore[no-untyped-def]
    Plan = apps.get_model("product_catalog", "Plan")
    Rule = apps.get_model("entitlements", "PlanEntitlementRule")
    Definition = apps.get_model("entitlements", "EntitlementDefinition")
    definitions = {
        item.code: item
        for item in Definition.objects.filter(
            code__in=("focus.workspace", "content.premium", "files.download")
        )
    }
    for plan_code in ("lockin_trial", "lockin_monthly"):
        plan = Plan.objects.get(code=plan_code)
        version = plan.current_version
        for definition in definitions.values():
            Rule.objects.get_or_create(
                plan_version=version,
                entitlement=definition,
                defaults={"configuration": {}},
            )


class Migration(migrations.Migration):
    dependencies = [
        ("entitlements", "0003_backfill_subscription_grants"),
        ("product_catalog", "0004_seed_lockin_trial_and_monthly"),
    ]
    operations = [migrations.RunPython(seed_subscription_rules, migrations.RunPython.noop)]

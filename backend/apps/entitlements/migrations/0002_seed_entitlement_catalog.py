from django.db import migrations


DEFINITIONS = (
    ("focus.workspace", "Focus workspace", "Professional document study workspace."),
    ("content.premium", "Premium learning content", "Access to entitled premium learning objects."),
    ("files.download", "Offline downloads", "Download entitled learning resources."),
    ("ai.assistance", "AI assistance", "Reserved capability; no AI access is granted in Phase 8."),
)


def seed_entitlements(apps, schema_editor):  # type: ignore[no-untyped-def]
    Definition = apps.get_model("entitlements", "EntitlementDefinition")
    Rule = apps.get_model("entitlements", "PlanEntitlementRule")
    Plan = apps.get_model("product_catalog", "Plan")
    version = Plan.objects.get(code="lockin_trial").current_version
    for code, title, description in DEFINITIONS:
        entitlement, _ = Definition.objects.get_or_create(
            code=code,
            defaults={
                "title": title,
                "description": description,
                "value_type": "boolean",
                "is_active": True,
            },
        )
        if code != "ai.assistance":
            Rule.objects.get_or_create(plan_version=version, entitlement=entitlement)


class Migration(migrations.Migration):
    dependencies = [
        ("entitlements", "0001_initial"),
        ("product_catalog", "0002_seed_trial_catalog"),
    ]

    operations = [migrations.RunPython(seed_entitlements, migrations.RunPython.noop)]

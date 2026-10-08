"""Give the dentistry term plans the study entitlements they are sold as granting.

``product_catalog.0007`` publishes the pre-midterm, post-midterm and full-year
plans. Without rules a paid subscription on them would revoke every study grant
(see ``0005_seed_libyana_offer_plan_rules``), so they get the same three.
"""

from django.db import migrations

STUDY_ENTITLEMENTS = ("focus.workspace", "content.premium", "files.download")
TERM_PLANS = ("dentistry_pre_midterm", "dentistry_post_midterm", "dentistry_full_year")


def seed_term_plan_rules(apps, schema_editor):  # type: ignore[no-untyped-def]
    PlanVersion = apps.get_model("product_catalog", "PlanVersion")
    Rule = apps.get_model("entitlements", "PlanEntitlementRule")
    Definition = apps.get_model("entitlements", "EntitlementDefinition")

    definitions = list(Definition.objects.filter(code__in=STUDY_ENTITLEMENTS, is_active=True))
    for version in PlanVersion.objects.filter(plan__code__in=TERM_PLANS):
        for definition in definitions:
            Rule.objects.get_or_create(
                plan_version=version,
                entitlement=definition,
                defaults={"configuration": {}},
            )


class Migration(migrations.Migration):
    dependencies = [
        ("entitlements", "0005_seed_libyana_offer_plan_rules"),
        ("product_catalog", "0007_dentistry_term_plans"),
    ]

    operations = [migrations.RunPython(seed_term_plan_rules, migrations.RunPython.noop)]

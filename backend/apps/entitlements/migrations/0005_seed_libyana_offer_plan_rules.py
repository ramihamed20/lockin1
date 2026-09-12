"""Give every purchasable plan the study entitlements it is sold as granting.

``0004_seed_subscription_plan_rules`` named two plans explicitly --
``lockin_trial`` and ``lockin_monthly``. ``product_catalog.0005`` then added
four more purchasable plans (the 5 LYD first month, and the two, three and four
month offers) and nothing gave them rules.

A plan version with no rules is not a plan that grants nothing extra; it is a
plan that grants *nothing*. ``sync_subscription_entitlements`` builds the set of
entitlements a subscription should hold from its plan version's rules and
revokes every grant outside that set, so a reader who paid for one of those four
offers had their subscription moved onto the paid plan version and every study
entitlement revoked with ``plan_rule_removed`` in the same transaction. They
ended with an ACTIVE, VERIFIED, fully paid subscription and no access to
anything -- and the subscription screen, reading the subscription rather than
the grants, told them their payment was approved.

This backfills any version that sells something and grants nothing. It is
written against prices rather than a list of plan codes so it covers the four
offers without naming them, and ``apps.entitlements.tests.test_plan_entitlement_coverage``
keeps a future plan from reintroducing the gap.
"""

from django.db import migrations

STUDY_ENTITLEMENTS = ("focus.workspace", "content.premium", "files.download")


def seed_missing_plan_rules(apps, schema_editor):  # type: ignore[no-untyped-def]
    PlanVersion = apps.get_model("product_catalog", "PlanVersion")
    Price = apps.get_model("product_catalog", "Price")
    Rule = apps.get_model("entitlements", "PlanEntitlementRule")
    Definition = apps.get_model("entitlements", "EntitlementDefinition")

    definitions = list(Definition.objects.filter(code__in=STUDY_ENTITLEMENTS, is_active=True))
    if not definitions:
        return
    sellable = PlanVersion.objects.filter(
        id__in=Price.objects.filter(status="active").values("plan_version_id")
    )
    for version in sellable:
        if Rule.objects.filter(plan_version=version).exists():
            continue
        for definition in definitions:
            Rule.objects.get_or_create(
                plan_version=version,
                entitlement=definition,
                defaults={"configuration": {}},
            )


class Migration(migrations.Migration):
    dependencies = [
        ("entitlements", "0004_seed_subscription_plan_rules"),
        ("product_catalog", "0006_seed_dentistry_half_year_coming_soon"),
    ]

    operations = [migrations.RunPython(seed_missing_plan_rules, migrations.RunPython.noop)]

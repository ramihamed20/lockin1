"""Grant only question and review capabilities to the question-only offers."""
from django.db import migrations


PLAN_CODES = (
    "tripoli_y2_questions_pre",
    "tripoli_y2_questions_post",
    "tripoli_y2_questions_year",
)
SCOPE = {"program_code": "dentistry-tripoli", "cohort_code": "year-2"}


def seed_question_entitlements(apps, schema_editor):  # type: ignore[no-untyped-def]
    Definition = apps.get_model("entitlements", "EntitlementDefinition")
    Rule = apps.get_model("entitlements", "PlanEntitlementRule")
    Plan = apps.get_model("product_catalog", "Plan")

    entitlement, _ = Definition.objects.get_or_create(
        code="questions.access",
        defaults={
            "title": "Questions and review",
            "description": "Question banks, previous exams, practice and review; not PDF study materials.",
            "value_type": "boolean",
            "is_active": True,
        },
    )
    for plan in Plan.objects.filter(code__in=PLAN_CODES).select_related("current_version"):
        if plan.current_version_id:
            Rule.objects.get_or_create(
                plan_version_id=plan.current_version_id,
                entitlement=entitlement,
                defaults={"configuration": SCOPE},
            )


class Migration(migrations.Migration):
    dependencies = [
        ("entitlements", "0006_seed_term_plan_rules"),
        ("product_catalog", "0009_tripoli_y2_question_only_plans"),
    ]
    operations = [
        migrations.RunPython(seed_question_entitlements, migrations.RunPython.noop),
    ]

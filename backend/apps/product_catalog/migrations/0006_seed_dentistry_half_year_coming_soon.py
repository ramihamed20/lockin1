from django.db import migrations
from django.utils import timezone


PLAN_CODE = "dentistry_half_year"


def seed_dentistry_half_year(apps, schema_editor):  # type: ignore[no-untyped-def]
    Product = apps.get_model("product_catalog", "Product")
    Plan = apps.get_model("product_catalog", "Plan")
    PlanVersion = apps.get_model("product_catalog", "PlanVersion")

    product = Product.objects.get(code="lockin")
    plan, _ = Plan.objects.get_or_create(
        code=PLAN_CODE,
        defaults={"product": product, "status": "active"},
    )
    version, _ = PlanVersion.objects.get_or_create(
        plan=plan,
        version=1,
        defaults={
            "title": "نصف السنة - طب الأسنان",
            "description": "جميع الكليات والسنوات",
            "audience": "individual",
            "trial_days": 0,
            "grace_days": 0,
            "terms": {
                "availability": "coming_soon",
                "scope": {
                    "program_family": "dentistry",
                    "program_code_prefix": "dentistry-",
                    "all_colleges": True,
                    "all_years": True,
                },
                "duration_policy": "dentistry_half_year_tbd",
                "duration_defined": False,
                "data_retained_after_expiry": True,
            },
            "published_at": timezone.now(),
        },
    )
    Plan.objects.filter(id=plan.id).update(
        product=product,
        status="active",
        current_version=version,
    )


class Migration(migrations.Migration):
    dependencies = [("product_catalog", "0005_libyana_subscription_offers")]
    operations = [
        # Deliberately irreversible: a later release may attach pricing or history
        # to this stable plan code, and rolling back must never delete that data.
        migrations.RunPython(seed_dentistry_half_year, migrations.RunPython.noop),
    ]

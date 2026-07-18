from django.db import migrations
from django.utils import timezone


def seed_trial_catalog(apps, schema_editor):  # type: ignore[no-untyped-def]
    Product = apps.get_model("product_catalog", "Product")
    Plan = apps.get_model("product_catalog", "Plan")
    PlanVersion = apps.get_model("product_catalog", "PlanVersion")
    product, _ = Product.objects.get_or_create(
        code="lockin",
        defaults={
            "title": "Lock-in",
            "description": "The Lock-in learning operating system.",
            "status": "active",
        },
    )
    plan, _ = Plan.objects.get_or_create(
        code="lockin_trial",
        defaults={"product": product, "status": "active"},
    )
    version, _ = PlanVersion.objects.get_or_create(
        plan=plan,
        version=1,
        defaults={
            "title": "Lock-in trial",
            "description": "Thirty days to explore the core Lock-in study experience.",
            "audience": "individual",
            "trial_days": 30,
            "grace_days": 0,
            "terms": {"policy": "trial-v1"},
            "published_at": timezone.now(),
        },
    )
    Plan.objects.filter(pk=plan.pk).update(status="active", current_version=version)
    Product.objects.filter(pk=product.pk).update(status="active")


class Migration(migrations.Migration):
    dependencies = [("product_catalog", "0001_initial")]

    operations = [migrations.RunPython(seed_trial_catalog, migrations.RunPython.noop)]

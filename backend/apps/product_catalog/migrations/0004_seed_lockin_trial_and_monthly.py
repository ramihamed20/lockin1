from django.db import migrations
from django.utils import timezone


def seed_subscription_catalog(apps, schema_editor):  # type: ignore[no-untyped-def]
    Product = apps.get_model("product_catalog", "Product")
    Plan = apps.get_model("product_catalog", "Plan")
    PlanVersion = apps.get_model("product_catalog", "PlanVersion")
    Price = apps.get_model("product_catalog", "Price")

    product, _ = Product.objects.get_or_create(
        code="lockin",
        defaults={
            "title": "Lock-in",
            "description": "Focused study access with saved progress.",
            "status": "active",
        },
    )
    Product.objects.filter(id=product.id).update(status="active")

    trial, _ = Plan.objects.get_or_create(
        code="lockin_trial", defaults={"product": product, "status": "active"}
    )
    trial_version, _ = PlanVersion.objects.get_or_create(
        plan=trial,
        version=2,
        defaults={
            "title": "Free Trial",
            "description": "Seven days of complete Lock-in study access.",
            "audience": "individual",
            "trial_days": 7,
            "grace_days": 0,
            "terms": {"policy": "trial-v2", "data_retained_after_expiry": True},
            "published_at": timezone.now(),
        },
    )
    Plan.objects.filter(id=trial.id).update(
        product=product, status="active", current_version=trial_version
    )

    monthly, _ = Plan.objects.get_or_create(
        code="lockin_monthly", defaults={"product": product, "status": "active"}
    )
    monthly_version, _ = PlanVersion.objects.get_or_create(
        plan=monthly,
        version=1,
        defaults={
            "title": "Monthly",
            "description": "Thirty days of Lock-in study access.",
            "audience": "individual",
            "trial_days": 0,
            "grace_days": 7,
            "terms": {
                "policy": "manual-libyana-v1",
                "duration_days": 30,
                "data_retained_after_expiry": True,
            },
            "published_at": timezone.now(),
        },
    )
    Plan.objects.filter(id=monthly.id).update(
        product=product, status="active", current_version=monthly_version
    )
    Price.objects.get_or_create(
        code="lockin_monthly_10_lyd",
        defaults={
            "plan_version": monthly_version,
            "amount_minor": 10_000,
            "currency": "LYD",
            "currency_exponent": 3,
            "region_code": "LY",
            "interval": "day",
            "interval_count": 30,
            "tax_behavior": "unspecified",
            "status": "active",
            "published_at": timezone.now(),
        },
    )


class Migration(migrations.Migration):
    dependencies = [("product_catalog", "0003_price_currency_exponent_and_more")]
    operations = [migrations.RunPython(seed_subscription_catalog, migrations.RunPython.noop)]

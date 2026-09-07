from django.db import migrations, models
from django.utils import timezone


def seed_libyana_offers(apps, schema_editor):  # type: ignore[no-untyped-def]
    Product = apps.get_model("product_catalog", "Product")
    Plan = apps.get_model("product_catalog", "Plan")
    PlanVersion = apps.get_model("product_catalog", "PlanVersion")
    Price = apps.get_model("product_catalog", "Price")

    product = Product.objects.get(code="lockin")
    now = timezone.now()
    offers = (
        ("lockin_first_month", "الشهر الأول", "عرض أول اشتراك", 5_000, 1, True),
        ("lockin_two_months", "شهران", "اشتراك لمدة شهرين", 20_000, 2, False),
        ("lockin_three_months", "3 أشهر", "اشتراك لمدة ثلاثة أشهر", 25_000, 3, False),
        ("lockin_four_months", "4 أشهر", "اشتراك لمدة أربعة أشهر", 30_000, 4, False),
    )
    for code, title, description, amount_minor, months, first_only in offers:
        plan, _ = Plan.objects.get_or_create(
            code=code, defaults={"product": product, "status": "active"}
        )
        version, _ = PlanVersion.objects.get_or_create(
            plan=plan,
            version=1,
            defaults={
                "title": title,
                "description": description,
                "audience": "individual",
                "trial_days": 0,
                "grace_days": 7,
                "terms": {"policy": "manual-libyana-v2", "months": months},
                "published_at": now,
            },
        )
        Plan.objects.filter(id=plan.id).update(
            product=product, status="active", current_version=version
        )
        Price.objects.get_or_create(
            code=f"{code}_{amount_minor // 1000}_lyd",
            defaults={
                "plan_version": version,
                "amount_minor": amount_minor,
                "currency": "LYD",
                "currency_exponent": 3,
                "region_code": "LY",
                "interval": "month",
                "interval_count": months,
                "tax_behavior": "unspecified",
                "status": "active",
                "first_subscription_only": first_only,
                "published_at": now,
            },
        )


class Migration(migrations.Migration):
    dependencies = [("product_catalog", "0004_seed_lockin_trial_and_monthly")]

    operations = [
        migrations.AddField(
            model_name="price",
            name="first_subscription_only",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(seed_libyana_offers, migrations.RunPython.noop),
    ]

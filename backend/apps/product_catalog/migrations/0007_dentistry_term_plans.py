from datetime import datetime, timedelta, timezone

from django.db import migrations, models
from django.utils import timezone as django_timezone

# Literal copies of apps.product_catalog.dentistry_terms: a migration must keep
# describing the release it shipped in even if those constants change later.
TRIPOLI = timezone(timedelta(hours=2))
PRE_MIDTERM_ENDS_AT = datetime(2027, 1, 25, 23, 59, 59, tzinfo=TRIPOLI)
POST_MIDTERM_ENDS_AT = datetime(2027, 5, 21, 23, 59, 59, tzinfo=TRIPOLI)
FIRST_MONTH_OFFER_ENDS_AT = datetime(2026, 10, 10, 0, 0, tzinfo=TRIPOLI)

SCOPE = {
    "program_family": "dentistry",
    "program_code_prefix": "dentistry-",
    "all_colleges": True,
    "all_years": True,
}

# code, title, description, months shown, ends at, prices
# price: (code, amount_minor, eligibility, installments)
TERM_PLANS = (
    (
        "dentistry_pre_midterm",
        "قبل النصفي",
        "اشتراك حتى 25 يناير 2027",
        4,
        PRE_MIDTERM_ENDS_AT,
        (
            ("dentistry_pre_midterm_45_lyd", 45_000, "", [20_000, 15_000, 10_000]),
            (
                "dentistry_pre_midterm_loyalty_35_lyd",
                35_000,
                "loyalty_2026",
                [20_000, 10_000, 5_000],
            ),
        ),
    ),
    (
        "dentistry_post_midterm",
        "بعد النصفي",
        "اشتراك حتى 21 مايو 2027",
        4,
        POST_MIDTERM_ENDS_AT,
        (("dentistry_post_midterm_50_lyd", 50_000, "", [25_000, 15_000, 10_000]),),
    ),
    (
        "dentistry_full_year",
        "العام الكامل",
        "اشتراك حتى 21 مايو 2027",
        8,
        POST_MIDTERM_ENDS_AT,
        (
            ("dentistry_full_year_90_lyd", 90_000, "", [30_000] + [10_000] * 6),
            (
                "dentistry_full_year_upgrade_40_lyd",
                40_000,
                "four_month_upgrade",
                [20_000, 10_000, 10_000],
            ),
        ),
    ),
)

RETIRED_PRICES = (
    "lockin_monthly_10_lyd",
    "lockin_two_months_20_lyd",
    "lockin_three_months_25_lyd",
    "lockin_four_months_30_lyd",
)


def seed_term_plans(apps, schema_editor):  # type: ignore[no-untyped-def]
    Product = apps.get_model("product_catalog", "Product")
    Plan = apps.get_model("product_catalog", "Plan")
    PlanVersion = apps.get_model("product_catalog", "PlanVersion")
    Price = apps.get_model("product_catalog", "Price")

    product = Product.objects.get(code="lockin")
    now = django_timezone.now()
    for code, title, description, months, ends_at, prices in TERM_PLANS:
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
                # A term ends on a calendar date; there is no grace after it.
                "grace_days": 0,
                "terms": {
                    "policy": "manual-libyana-term-v1",
                    "fixed_period_ends_at": ends_at.isoformat(),
                    "scope": SCOPE,
                    "data_retained_after_expiry": True,
                },
                "published_at": now,
            },
        )
        Plan.objects.filter(id=plan.id).update(
            product=product, status="active", current_version=version
        )
        for price_code, amount_minor, eligibility, installments in prices:
            Price.objects.get_or_create(
                code=price_code,
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
                    "eligibility": eligibility,
                    "installment_amounts_minor": installments,
                    "valid_until": ends_at,
                    "published_at": now,
                },
            )

    # The term plans replace the duration plans. Existing subscriptions keep
    # their plan version; only new sales stop.
    Price.objects.filter(code__in=RETIRED_PRICES, status="active").update(status="archived")
    Price.objects.filter(code="lockin_first_month_5_lyd", valid_until__isnull=True).update(
        valid_until=FIRST_MONTH_OFFER_ENDS_AT
    )
    # The "coming soon" half-year placeholder is superseded by the term plans.
    Plan.objects.filter(code="dentistry_half_year").update(status="archived")


class Migration(migrations.Migration):
    dependencies = [("product_catalog", "0006_seed_dentistry_half_year_coming_soon")]

    operations = [
        migrations.AddField(
            model_name="price",
            name="eligibility",
            field=models.CharField(
                blank=True,
                choices=[
                    ("", "Everyone"),
                    ("loyalty_2026", "Paid subscribers before the first-month offer ended"),
                    ("four_month_upgrade", "Four-month subscribers upgrading"),
                ],
                default="",
                max_length=40,
            ),
        ),
        migrations.AddField(
            model_name="price",
            name="installment_amounts_minor",
            field=models.JSONField(blank=True, default=list),
        ),
        # Irreversible on purpose, like 0006: payments will reference these prices.
        migrations.RunPython(seed_term_plans, migrations.RunPython.noop),
    ]

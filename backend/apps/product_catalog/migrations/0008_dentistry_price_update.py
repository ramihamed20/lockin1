from datetime import datetime, timedelta, timezone

from django.db import migrations, models
from django.utils import timezone as django_timezone

# Literal copies, like 0007: a migration must keep describing its own release.
TRIPOLI = timezone(timedelta(hours=2))
PRE_MIDTERM_ENDS_AT = datetime(2027, 1, 25, 23, 59, 59, tzinfo=TRIPOLI)
POST_MIDTERM_ENDS_AT = datetime(2027, 5, 21, 23, 59, 59, tzinfo=TRIPOLI)

# Payments reference prices, so the old ones are archived (existing payments and
# installment agreements keep them) and the new ones are added beside them.
SUPERSEDED = (
    "dentistry_pre_midterm_45_lyd",
    "dentistry_pre_midterm_loyalty_35_lyd",
    "dentistry_full_year_90_lyd",
    "dentistry_full_year_upgrade_40_lyd",
    # Briefly published in a local build before the upgrade moved to post-midterm.
    "dentistry_full_year_upgrade_30_lyd",
)

# plan code, price code, amount_minor, eligibility, installments, months, ends at
NEW_PRICES = (
    ("dentistry_pre_midterm", "dentistry_pre_midterm_30_lyd", 30_000, "", [15_000, 10_000, 5_000], 4, PRE_MIDTERM_ENDS_AT),
    (
        "dentistry_pre_midterm",
        "dentistry_pre_midterm_loyalty_25_lyd",
        25_000,
        "loyalty_2026",
        [10_000, 10_000, 5_000],
        4,
        PRE_MIDTERM_ENDS_AT,
    ),
    (
        "dentistry_full_year",
        "dentistry_full_year_80_lyd",
        80_000,
        "",
        [30_000] + [10_000] * 5,
        8,
        POST_MIDTERM_ENDS_AT,
    ),
    (
        "dentistry_full_year",
        "dentistry_full_year_loyalty_70_lyd",
        70_000,
        "loyalty_2026",
        [30_000] + [10_000] * 4,
        8,
        POST_MIDTERM_ENDS_AT,
    ),
    (
        "dentistry_post_midterm",
        "dentistry_post_midterm_upgrade_20_lyd",
        20_000,
        "four_month_upgrade",
        [10_000, 10_000],
        4,
        POST_MIDTERM_ENDS_AT,
    ),
)


def apply_price_update(apps, schema_editor):  # type: ignore[no-untyped-def]
    Plan = apps.get_model("product_catalog", "Plan")
    Price = apps.get_model("product_catalog", "Price")

    now = django_timezone.now()
    for plan_code, code, amount, eligibility, installments, months, ends_at in NEW_PRICES:
        plan = Plan.objects.get(code=plan_code)
        Price.objects.get_or_create(
            code=code,
            defaults={
                "plan_version_id": plan.current_version_id,
                "amount_minor": amount,
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
    Price.objects.filter(code__in=SUPERSEDED, status="active").update(status="archived")


class Migration(migrations.Migration):
    dependencies = [("product_catalog", "0007_dentistry_term_plans")]

    operations = [
        migrations.AlterField(
            model_name="price",
            name="eligibility",
            field=models.CharField(
                blank=True,
                choices=[
                    ("", "Everyone"),
                    ("loyalty_2026", "Paid subscribers before the first-month offer ended"),
                    (
                        "four_month_upgrade",
                        "Four-month subscribers upgrading",
                    ),
                ],
                default="",
                max_length=40,
            ),
        ),
        migrations.RunPython(apply_price_update, migrations.RunPython.noop),
    ]

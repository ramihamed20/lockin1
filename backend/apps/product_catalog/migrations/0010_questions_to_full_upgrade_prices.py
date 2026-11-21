"""Discounted feature upgrades for paid Tripoli Year 2 question-only terms.

Prices are new immutable records, not replacements for existing transactions.
The source and target periods must match; runtime eligibility checks ownership,
successful payment and the current verified question-only subscription.
"""

from datetime import datetime, timedelta, timezone

from django.db import migrations, models
from django.utils import timezone as django_timezone

TRIPOLI = timezone(timedelta(hours=2))
PRE_END = datetime(2027, 1, 25, 23, 59, 59, tzinfo=TRIPOLI)
POST_START = datetime(2027, 1, 26, 0, 0, 0, tzinfo=TRIPOLI)
YEAR_END = datetime(2027, 5, 21, 23, 59, 59, tzinfo=TRIPOLI)

# Target full plan, new price code, difference in thousandths of LYD,
# restricted eligibility, sale window.
UPGRADE_PRICES = (
    (
        "dentistry_pre_midterm",
        "dentistry_pre_midterm_questions_upgrade_15_lyd",
        15_000,
        "questions_pre_upgrade",
        None,
        PRE_END,
    ),
    (
        "dentistry_post_midterm",
        "dentistry_post_midterm_questions_upgrade_15_lyd",
        15_000,
        "questions_post_upgrade",
        POST_START,
        YEAR_END,
    ),
    (
        "dentistry_full_year",
        "dentistry_full_year_questions_upgrade_30_lyd",
        30_000,
        "questions_year_upgrade",
        None,
        YEAR_END,
    ),
)


def seed_upgrade_prices(apps, schema_editor):  # type: ignore[no-untyped-def]
    Plan = apps.get_model("product_catalog", "Plan")
    Price = apps.get_model("product_catalog", "Price")
    now = django_timezone.now()
    for target, code, difference, eligibility, starts, ends in UPGRADE_PRICES:
        plan = Plan.objects.select_related("current_version").get(code=target)
        version = plan.current_version
        Price.objects.get_or_create(
            code=code,
            defaults={
                "plan_version": version,
                "amount_minor": difference,
                "currency": "LYD",
                "currency_exponent": 3,
                "region_code": "LY",
                "interval": "month",
                "interval_count": 4 if target != "dentistry_full_year" else 8,
                "eligibility": eligibility,
                "installment_amounts_minor": [],
                "status": "active",
                "valid_from": starts,
                "valid_until": ends,
                "published_at": now,
            },
        )


class Migration(migrations.Migration):
    dependencies = [
        ("product_catalog", "0009_tripoli_y2_question_only_plans"),
    ]

    operations = [
        migrations.AlterField(
            model_name="price",
            name="eligibility",
            field=models.CharField(
                blank=True,
                choices=[
                    ("", "Everyone"),
                    ("loyalty_2026", "Paid subscribers before the first-month offer ended"),
                    ("four_month_upgrade", "Four-month subscribers upgrading"),
                    ("questions_pre_upgrade", "Upgrade pre-midterm questions to full"),
                    ("questions_post_upgrade", "Upgrade post-midterm questions to full"),
                    ("questions_year_upgrade", "Upgrade full-year questions to full"),
                ],
                default="",
                max_length=40,
            ),
        ),
        migrations.RunPython(seed_upgrade_prices, migrations.RunPython.noop),
    ]

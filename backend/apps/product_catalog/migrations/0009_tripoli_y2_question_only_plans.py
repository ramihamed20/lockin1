"""Question-only 2026/27 offers for Tripoli Dentistry Year 2.

Keep the fixed-term dates consistent with dentistry_terms.py. No existing
plan/price is changed, and this migration is intentionally non-destructive.
"""
from datetime import datetime, timedelta, timezone

from django.db import migrations
from django.utils import timezone as django_timezone


TRIPOLI = timezone(timedelta(hours=2))
PRE_END = datetime(2027, 1, 25, 23, 59, 59, tzinfo=TRIPOLI)
POST_START = datetime(2027, 1, 26, 0, 0, 0, tzinfo=TRIPOLI)
YEAR_END = datetime(2027, 5, 21, 23, 59, 59, tzinfo=TRIPOLI)

SCOPE = {"program_code": "dentistry-tripoli", "cohort_code": "year-2"}

# plan code, plan title, description, amount in thousandths of LYD,
# approximate advertised months, end of access, first sale date
OFFERS = (
    ("tripoli_y2_questions_pre", "الأسئلة فقط — قبل النصفي", "حتى 25 يناير 2027", 15_000, 4, PRE_END, None),
    ("tripoli_y2_questions_post", "الأسئلة فقط — بعد النصفي", "من 26 يناير حتى 21 مايو 2027", 35_000, 4, YEAR_END, POST_START),
    ("tripoli_y2_questions_year", "الأسئلة فقط — العام الكامل", "حتى 21 مايو 2027", 50_000, 8, YEAR_END, None),
)


def seed_question_offers(apps, schema_editor):  # type: ignore[no-untyped-def]
    Product = apps.get_model("product_catalog", "Product")
    Plan = apps.get_model("product_catalog", "Plan")
    PlanVersion = apps.get_model("product_catalog", "PlanVersion")
    Price = apps.get_model("product_catalog", "Price")

    product = Product.objects.get(code="lockin")
    now = django_timezone.now()
    for code, title, description, amount, months, ends_at, valid_from in OFFERS:
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
                "grace_days": 0,
                "terms": {
                    "policy": "manual-libyana-questions-only-2026-27",
                    "fixed_period_ends_at": ends_at.isoformat(),
                    "scope": SCOPE,
                    "questions_only": True,
                    "data_retained_after_expiry": True,
                },
                "published_at": now,
            },
        )
        Plan.objects.filter(id=plan.id).update(
            product=product, status="active", current_version=version
        )
        Price.objects.get_or_create(
            code=f"{code}_{amount // 1000}_lyd",
            defaults={
                "plan_version": version,
                "amount_minor": amount,
                "currency": "LYD",
                "currency_exponent": 3,
                "region_code": "LY",
                "interval": "month",
                "interval_count": months,
                "status": "active",
                "valid_from": valid_from,
                "valid_until": ends_at,
                "published_at": now,
            },
        )


class Migration(migrations.Migration):
    dependencies = [("product_catalog", "0008_dentistry_price_update")]
    operations = [
        migrations.RunPython(seed_question_offers, migrations.RunPython.noop),
    ]

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.product_catalog.models import Plan, Price
from apps.product_catalog.selectors import active_libyana_price_for_plan, active_price

pytestmark = pytest.mark.django_db


def test_dentistry_half_year_is_visible_and_scoped_without_a_price() -> None:
    client = APIClient()
    client.force_authenticate(create_user(email="catalog-coming-soon@example.com"))
    response = client.get("/api/v1/catalog/products")

    assert response.status_code == 200
    plans = [
        plan
        for product in response.json()["results"]
        for plan in product["plans"]
        if plan["code"] == "dentistry_half_year"
    ]
    assert len(plans) == 1
    version = plans[0]["current_version"]
    assert version["title"] == "نصف السنة - طب الأسنان"
    assert version["availability"] == "coming_soon"
    assert version["scope"] == {
        "program_family": "dentistry",
        "program_code_prefix": "dentistry-",
        "all_colleges": True,
        "all_years": True,
    }
    assert version["prices"] == []


def test_coming_soon_plan_is_rejected_by_all_purchase_price_selectors() -> None:
    plan = Plan.objects.select_related("current_version").get(code="dentistry_half_year")
    assert plan.current_version is not None
    price = Price.objects.create(
        plan_version=plan.current_version,
        code="dentistry_half_year_test_only",
        amount_minor=1,
        currency="LYD",
        currency_exponent=3,
        region_code="LY",
        interval=Price.Interval.DAY,
        interval_count=1,
        status=Price.Status.ACTIVE,
        published_at=timezone.now(),
    )

    with pytest.raises(Price.DoesNotExist):
        active_price(price_id=price.id)
    with pytest.raises(Price.DoesNotExist):
        active_libyana_price_for_plan(plan_id=plan.id)

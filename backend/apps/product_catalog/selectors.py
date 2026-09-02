from uuid import UUID

from django.db import models
from django.db.models import Prefetch, Q, QuerySet
from django.utils import timezone

from .models import Plan, Price, Product


def available_products(*, region_code: str = "") -> QuerySet[Product]:
    now = timezone.now()
    prices = Price.objects.filter(status=Price.Status.ACTIVE).filter(
        Q(valid_from__isnull=True) | Q(valid_from__lte=now),
        Q(valid_until__isnull=True) | Q(valid_until__gt=now),
    )
    if region_code:
        prices = prices.filter(Q(region_code="") | Q(region_code=region_code.upper()))
    plans = (
        Plan.objects.filter(status=Plan.Status.ACTIVE, current_version__isnull=False)
        .select_related("current_version")
        .prefetch_related(Prefetch("current_version__prices", queryset=prices))
    )
    return Product.objects.filter(status=Product.Status.ACTIVE).prefetch_related(
        Prefetch("plans", queryset=plans)
    )


def active_price(*, price_id: UUID | str) -> Price:
    now = timezone.now()
    return (
        Price.objects.select_related("plan_version__plan__product")
        .filter(
            id=price_id,
            status=Price.Status.ACTIVE,
            plan_version__published_at__isnull=False,
            plan_version__plan__status=Plan.Status.ACTIVE,
        )
        .filter(
            Q(valid_from__isnull=True) | Q(valid_from__lte=now),
            Q(valid_until__isnull=True) | Q(valid_until__gt=now),
        )
        .get()
    )


def active_libyana_price_for_plan(*, plan_id: UUID | str) -> Price:
    now = timezone.now()
    price = (
        Price.objects.select_related("plan_version__plan__product")
        .filter(
            plan_version__plan_id=plan_id,
            plan_version__plan__current_version_id=models.F("plan_version_id"),
            plan_version__plan__status=Plan.Status.ACTIVE,
            plan_version__published_at__isnull=False,
            status=Price.Status.ACTIVE,
            currency="LYD",
        )
        .filter(
            Q(region_code="") | Q(region_code="LY"),
            Q(valid_from__isnull=True) | Q(valid_from__lte=now),
            Q(valid_until__isnull=True) | Q(valid_until__gt=now),
        )
        .order_by("-published_at", "id")
        .first()
    )
    if price is None:
        raise Price.DoesNotExist
    return price

from datetime import datetime

from django.db import transaction
from django.utils import timezone

from platform_core.events import publish_after_commit

from .events import PlanPublished, PricePublished
from .models import Plan, PlanVersion, Price, Product
from .validation import validate_catalog_code, validate_currency, validate_region


@transaction.atomic
def create_plan_version(
    *,
    product: Product,
    plan_code: str,
    title: str,
    description: str = "",
    audience: str = PlanVersion.Audience.INDIVIDUAL,
    trial_days: int = 0,
    grace_days: int = 0,
    terms: dict[str, object] | None = None,
) -> PlanVersion:
    if trial_days < 0 or grace_days < 0:
        raise ValueError("Trial and grace days cannot be negative.")
    code = validate_catalog_code(plan_code)
    plan, _ = Plan.objects.select_for_update().get_or_create(
        code=code,
        defaults={"product": product},
    )
    if plan.product_id != product.id:
        raise ValueError("A plan code cannot move between products.")
    latest = plan.versions.order_by("-version").first()
    return PlanVersion.objects.create(
        plan=plan,
        version=1 if latest is None else latest.version + 1,
        title=title.strip(),
        description=description.strip(),
        audience=audience,
        trial_days=trial_days,
        grace_days=grace_days,
        terms=terms or {},
    )


@transaction.atomic
def publish_plan_version(*, plan_version: PlanVersion) -> PlanVersion:
    plan = Plan.objects.select_for_update().select_related("product").get(id=plan_version.plan_id)
    version = PlanVersion.objects.select_for_update().get(id=plan_version.id, plan=plan)
    if not version.title:
        raise ValueError("A plan title is required before publication.")
    now = timezone.now()
    version.published_at = version.published_at or now
    version.save(update_fields=("published_at",))
    plan.current_version = version
    plan.status = Plan.Status.ACTIVE
    plan.save(update_fields=("current_version", "status", "updated_at"))
    if plan.product.status != Product.Status.ACTIVE:
        Product.objects.filter(id=plan.product_id).update(status=Product.Status.ACTIVE)
    publish_after_commit(PlanPublished(plan_id=plan.id, plan_version_id=version.id))
    return version


@transaction.atomic
def create_price(
    *,
    plan_version: PlanVersion,
    code: str,
    amount_minor: int,
    currency: str,
    currency_exponent: int = 2,
    interval: str,
    interval_count: int = 1,
    region_code: str = "",
    valid_from: datetime | None = None,
    valid_until: datetime | None = None,
) -> Price:
    if amount_minor <= 0 or interval_count <= 0:
        raise ValueError("Price amount and interval count must be positive.")
    if not 0 <= currency_exponent <= 4:
        raise ValueError("Currency exponent must be between zero and four.")
    if valid_from and valid_until and valid_until <= valid_from:
        raise ValueError("Price validity must end after it starts.")
    return Price.objects.create(
        plan_version=plan_version,
        code=validate_catalog_code(code),
        amount_minor=amount_minor,
        currency=validate_currency(currency),
        currency_exponent=currency_exponent,
        region_code=validate_region(region_code),
        interval=interval,
        interval_count=interval_count,
        valid_from=valid_from,
        valid_until=valid_until,
    )


@transaction.atomic
def publish_price(*, price: Price) -> Price:
    price = Price.objects.select_for_update().select_related("plan_version__plan").get(id=price.id)
    if price.plan_version.published_at is None:
        raise ValueError("Publish the plan version before publishing a price.")
    price.status = Price.Status.ACTIVE
    price.published_at = price.published_at or timezone.now()
    price.save(update_fields=("status", "published_at"))
    publish_after_commit(PricePublished(price_id=price.id, plan_version_id=price.plan_version_id))
    return price

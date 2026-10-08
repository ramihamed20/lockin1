from typing import Any

from django.conf import settings
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Price, Product
from .selectors import available_products, price_for_reader
from .serializers import ProductSerializer


def _general_prices(results: Any) -> Any:
    for product in results:
        for plan in product["plans"]:
            version = plan.get("current_version")
            if version:
                version["prices"] = [p for p in version["prices"] if not p["eligibility"]]
    return results


def _prices_for_reader(*, products: list[Product], results: Any, user: Any) -> Any:
    """Narrow each plan to the one price this reader would pay, and say if they can.

    The submission path re-checks all of it; this only keeps the screen from
    offering a price or a plan the server would refuse.
    """

    # Imported here: payments reads catalog models, so a module-level import in
    # this direction would close the loop.
    from apps.payments.installments import installments_available
    from apps.payments.manual_services import price_eligibilities, purchase_block_reason
    from apps.subscriptions.selectors import current_subscription_for_user

    now = timezone.now()
    eligibilities = price_eligibilities(user=user)
    subscription = current_subscription_for_user(user=user)
    prices_by_plan: dict[str, list[Price]] = {}
    for product in products:
        for plan in product.plans.all():
            version = plan.current_version
            if version is None:
                continue
            prices = list(version.prices.all())
            for price in prices:
                price.plan_version = version
            prices_by_plan[str(plan.id)] = prices
    for product_data in results:
        for plan_data in product_data["plans"]:
            version_data = plan_data.get("current_version")
            if not version_data:
                continue
            chosen = price_for_reader(
                prices=prices_by_plan.get(str(plan_data["id"]), []),
                eligibilities=eligibilities,
            )
            if chosen is None:
                version_data["prices"] = []
                continue
            version_data["prices"] = [
                {
                    **price_data,
                    "purchase_blocked_reason": purchase_block_reason(
                        subscription=subscription, price=chosen, now=now
                    ),
                    "installments_available": installments_available(price=chosen, now=now),
                }
                for price_data in version_data["prices"]
                if price_data["id"] == str(chosen.id)
            ]
    return results


class ProductCatalogView(APIView):
    def get(self, request: Request) -> Response:
        region = request.query_params.get("region", "")[:2]
        products = list(available_products(region_code=region))
        has_used_first_offer = False
        results = ProductSerializer(products, many=True).data
        if request.user.is_authenticated:
            from apps.payments.models import Payment

            has_used_first_offer = Payment.objects.filter(
                account__primary_user=request.user,
                status=Payment.Status.SUCCEEDED,
            ).exists()
            results = _prices_for_reader(products=products, results=results, user=request.user)
        else:
            results = _general_prices(results)
        return Response(
            {
                "results": results,
                "checkout_available": settings.PAYMENT_PROVIDER != "none",
                "first_subscription_offer_eligible": not has_used_first_offer,
                "manual_payment_available": Price.objects.filter(
                    status=Price.Status.ACTIVE, currency="LYD"
                ).exists(),
            }
        )

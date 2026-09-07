from django.conf import settings
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Price
from .selectors import available_products
from .serializers import ProductSerializer


class ProductCatalogView(APIView):
    def get(self, request: Request) -> Response:
        region = request.query_params.get("region", "")[:2]
        products = available_products(region_code=region)
        has_used_first_offer = False
        if request.user.is_authenticated:
            from apps.payments.models import Payment

            has_used_first_offer = Payment.objects.filter(
                account__primary_user=request.user,
                status=Payment.Status.SUCCEEDED,
            ).exists()
        return Response(
            {
                "results": ProductSerializer(products, many=True).data,
                "checkout_available": settings.PAYMENT_PROVIDER != "none",
                "first_subscription_offer_eligible": not has_used_first_offer,
                "manual_payment_available": Price.objects.filter(
                    status=Price.Status.ACTIVE, currency="LYD"
                ).exists(),
            }
        )

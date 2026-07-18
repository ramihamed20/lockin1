from django.conf import settings
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .selectors import available_products
from .serializers import ProductSerializer


class ProductCatalogView(APIView):
    def get(self, request: Request) -> Response:
        region = request.query_params.get("region", "")[:2]
        products = available_products(region_code=region)
        return Response(
            {
                "results": ProductSerializer(products, many=True).data,
                "checkout_available": settings.PAYMENT_PROVIDER != "none",
            }
        )

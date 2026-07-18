from django.urls import path

from .views import ProductCatalogView

app_name = "product_catalog"

urlpatterns = [path("catalog/products", ProductCatalogView.as_view(), name="products")]

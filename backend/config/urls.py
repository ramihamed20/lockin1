from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from django.urls.resolvers import URLPattern, URLResolver
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns: list[URLPattern | URLResolver] = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("platform_core.api.urls")),
]

if settings.EXPOSE_API_DOCS:
    urlpatterns += [
        path("api/v1/schema/", SpectacularAPIView.as_view(), name="api-schema"),
        path(
            "api/v1/docs/",
            SpectacularSwaggerView.as_view(url_name="api-schema"),
            name="api-docs",
        ),
    ]

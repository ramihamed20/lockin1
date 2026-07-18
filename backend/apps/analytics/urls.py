from django.urls import path

from .views import AnalyticsSeriesView

app_name = "analytics"

urlpatterns = [path("operations/analytics", AnalyticsSeriesView.as_view(), name="series")]

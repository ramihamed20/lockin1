from django.urls import path

from .views import AchievementCatalogView

app_name = "achievements"

urlpatterns = [path("progression/achievements", AchievementCatalogView.as_view(), name="catalog")]

from django.urls import path

from .views import StreakSummaryView

app_name = "streaks"

urlpatterns = [path("progression/streak", StreakSummaryView.as_view(), name="summary")]

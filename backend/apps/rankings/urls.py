from django.urls import path

from .views import CurrentRankingView, RankingBuildView, RankingProfileView

app_name = "rankings"

urlpatterns = [
    path("progression/rankings/current", CurrentRankingView.as_view(), name="current"),
    path("progression/rankings/profile", RankingProfileView.as_view(), name="profile"),
    path("progression/rankings/<slug:code>/build", RankingBuildView.as_view(), name="build"),
]

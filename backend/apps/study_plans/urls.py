from django.urls import path

from .views import StudyPlanItemCollectionView, StudyPlanItemDetailView, StudyPlanView

app_name = "study_plans"

urlpatterns = [
    path("study-plan", StudyPlanView.as_view(), name="plan"),
    path("study-plan/items", StudyPlanItemCollectionView.as_view(), name="items"),
    path("study-plan/items/<uuid:item_id>", StudyPlanItemDetailView.as_view(), name="item"),
]

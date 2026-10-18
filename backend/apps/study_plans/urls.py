from django.urls import path

from .views import (
    StudyPlanGenerateView,
    StudyPlanItemCollectionView,
    StudyPlanItemDetailView,
    StudyPlanPreviewView,
    StudyPlanProfileView,
    StudyPlanView,
)

app_name = "study_plans"

urlpatterns = [
    path("study-plan", StudyPlanView.as_view(), name="plan"),
    path("study-plan/profile", StudyPlanProfileView.as_view(), name="profile"),
    path("study-plan/preview", StudyPlanPreviewView.as_view(), name="preview"),
    path("study-plan/generate", StudyPlanGenerateView.as_view(), name="generate"),
    path("study-plan/items", StudyPlanItemCollectionView.as_view(), name="items"),
    path("study-plan/items/<uuid:item_id>", StudyPlanItemDetailView.as_view(), name="item"),
]

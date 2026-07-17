from django.urls import path

from .views import (
    ManagementQuestionDetailView,
    ManagementQuestionListView,
    PublishQuestionView,
    RejectQuestionView,
    RetireQuestionView,
    SubmitQuestionView,
)

app_name = "questions"

urlpatterns = [
    path("management/questions", ManagementQuestionListView.as_view(), name="management-list"),
    path(
        "management/questions/<uuid:question_id>",
        ManagementQuestionDetailView.as_view(),
        name="management-detail",
    ),
    path(
        "management/questions/<uuid:question_id>/submit",
        SubmitQuestionView.as_view(),
        name="submit",
    ),
    path(
        "management/questions/<uuid:question_id>/publish",
        PublishQuestionView.as_view(),
        name="publish",
    ),
    path(
        "management/questions/<uuid:question_id>/reject",
        RejectQuestionView.as_view(),
        name="reject",
    ),
    path(
        "management/questions/<uuid:question_id>/retire",
        RetireQuestionView.as_view(),
        name="retire",
    ),
]

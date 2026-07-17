from django.urls import path

from .views import (
    AttemptActivityView,
    AttemptAnswerView,
    AttemptDetailView,
    AttemptResultView,
    AttemptSubmitView,
    ManagementQuizDetailView,
    ManagementQuizListView,
    PublicQuizDetailView,
    PublicQuizListView,
    PublishQuizView,
    QuestionIssueReportView,
    RejectQuizView,
    RetireQuizView,
    ReviewQueueView,
    StartAttemptView,
    SubmitQuizView,
)

app_name = "assessments"

urlpatterns = [
    path("quizzes", PublicQuizListView.as_view(), name="public-list"),
    path("quizzes/<uuid:quiz_id>", PublicQuizDetailView.as_view(), name="public-detail"),
    path("quizzes/<uuid:quiz_id>/attempts", StartAttemptView.as_view(), name="start-attempt"),
    path("attempts/<uuid:attempt_id>", AttemptDetailView.as_view(), name="attempt-detail"),
    path(
        "attempts/<uuid:attempt_id>/questions/<uuid:attempt_question_id>/answer",
        AttemptAnswerView.as_view(),
        name="save-answer",
    ),
    path(
        "attempts/<uuid:attempt_id>/submit",
        AttemptSubmitView.as_view(),
        name="submit-attempt",
    ),
    path(
        "attempts/<uuid:attempt_id>/activities",
        AttemptActivityView.as_view(),
        name="attempt-activity",
    ),
    path("assessment-results/<uuid:result_id>", AttemptResultView.as_view(), name="result"),
    path(
        "assessment-results/<uuid:result_id>/reports",
        QuestionIssueReportView.as_view(),
        name="report-question",
    ),
    path("assessment-review", ReviewQueueView.as_view(), name="review-queue"),
    path("management/quizzes", ManagementQuizListView.as_view(), name="management-list"),
    path(
        "management/quizzes/<uuid:quiz_id>",
        ManagementQuizDetailView.as_view(),
        name="management-detail",
    ),
    path(
        "management/quizzes/<uuid:quiz_id>/submit",
        SubmitQuizView.as_view(),
        name="submit-quiz",
    ),
    path(
        "management/quizzes/<uuid:quiz_id>/publish",
        PublishQuizView.as_view(),
        name="publish-quiz",
    ),
    path(
        "management/quizzes/<uuid:quiz_id>/reject",
        RejectQuizView.as_view(),
        name="reject-quiz",
    ),
    path(
        "management/quizzes/<uuid:quiz_id>/retire",
        RetireQuizView.as_view(),
        name="retire-quiz",
    ),
]

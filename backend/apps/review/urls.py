from django.urls import path

from .views import (
    QuestionAttemptView,
    ReviewBankAnswerView,
    ReviewBankSubjectView,
    ReviewBankView,
    ReviewQueueView,
    WeeklyRecallAnswerView,
    WeeklyRecallView,
)

app_name = "review"

urlpatterns = [
    path("question-attempts", QuestionAttemptView.as_view(), name="attempt"),
    path("review-queue", ReviewQueueView.as_view(), name="queue"),
    path("review-bank", ReviewBankView.as_view(), name="bank"),
    path(
        "review-bank/subjects/<path:subject_key>",
        ReviewBankSubjectView.as_view(),
        name="bank-subject",
    ),
    path(
        "review-bank/items/<uuid:item_id>/answer",
        ReviewBankAnswerView.as_view(),
        name="bank-answer",
    ),
    path("weekly-recall", WeeklyRecallView.as_view(), name="weekly"),
    path(
        "weekly-recall/<uuid:session_id>/questions/<uuid:question_id>/answer",
        WeeklyRecallAnswerView.as_view(),
        name="weekly-answer",
    ),
]

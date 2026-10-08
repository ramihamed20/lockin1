from django.urls import path

from .views import AdminFeedbackDetailView, AdminFeedbackListView, FeedbackCollectionView

app_name = "feedback"

urlpatterns = [
    path("feedback", FeedbackCollectionView.as_view(), name="collection"),
    path("operations/admin/feedback", AdminFeedbackListView.as_view(), name="admin-list"),
    path(
        "operations/admin/feedback/<uuid:feedback_id>",
        AdminFeedbackDetailView.as_view(),
        name="admin-detail",
    ),
]

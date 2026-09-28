from django.urls import path

from .views import (
    OfflineActiveStudyView,
    OfflineLeaseView,
    OfflineManifestView,
    OfflineQuestionsView,
    OfflineReviewView,
    OfflineSyncView,
)

app_name = "offline"

urlpatterns = [
    path("offline/lease/", OfflineLeaseView.as_view(), name="lease"),
    path("offline/manifest/", OfflineManifestView.as_view(), name="manifest"),
    path("offline/sync/", OfflineSyncView.as_view(), name="sync"),
    path("offline/questions/<uuid:sheet_id>/", OfflineQuestionsView.as_view(), name="questions"),
    path(
        "offline/active-study/<uuid:sheet_id>/",
        OfflineActiveStudyView.as_view(),
        name="active-study",
    ),
    path("offline/review/", OfflineReviewView.as_view(), name="review"),
]

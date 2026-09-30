from django.urls import path

from .views import BiweeklyHistoryView, BiweeklyPdfView, BiweeklyReportView, BiweeklyReviewTestView

app_name = "biweekly"

urlpatterns = [
    path("biweekly/<str:report_type>", BiweeklyHistoryView.as_view(), name="history"),
    path(
        "biweekly/<str:report_type>/<uuid:snapshot_id>", BiweeklyReportView.as_view(), name="report"
    ),
    path(
        "biweekly/<str:report_type>/<uuid:snapshot_id>/pdf", BiweeklyPdfView.as_view(), name="pdf"
    ),
    path("biweekly/review/<uuid:snapshot_id>/test", BiweeklyReviewTestView.as_view(), name="test"),
]

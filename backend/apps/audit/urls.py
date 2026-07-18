from django.urls import path

from .views import AuditRecordListView

app_name = "audit"

urlpatterns = [path("operations/audit", AuditRecordListView.as_view(), name="list")]

from django.urls import path

from .views import ActionExecuteView, ActionPreviewView

app_name = "operational_actions"

urlpatterns = [
    path("operations/actions/previews", ActionPreviewView.as_view(), name="preview"),
    path(
        "operations/actions/<str:run_id>/execute",
        ActionExecuteView.as_view(),
        name="execute",
    ),
]

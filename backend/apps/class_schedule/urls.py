from django.urls import path

from .views import MyGroupView

app_name = "class_schedule"

urlpatterns = [
    path("my-group", MyGroupView.as_view(), name="my-group"),
]

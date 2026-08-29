from uuid import UUID

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import StudyPlanItem
from .serializers import (
    StudyPlanItemUpdateSerializer,
    StudyPlanItemWriteSerializer,
    StudyPlanRangeSerializer,
    study_plan_item_payload,
)


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


class StudyPlanView(APIView):
    def get(self, request: Request) -> Response:
        query = StudyPlanRangeSerializer(
            data={
                "from_date": request.query_params.get("from"),
                "to_date": request.query_params.get("to"),
            }
        )
        query.is_valid(raise_exception=True)
        start = query.validated_data["from"]
        end = query.validated_data["to"]
        items = list(
            StudyPlanItem.objects.filter(
                user=_user(request),
                scheduled_date__range=(start, end),
            )
        )
        today = timezone.localdate()
        completed_count = 0
        planned_minutes = 0
        completed_minutes = 0
        today_count = 0
        today_minutes = 0
        for item in items:
            planned_minutes += item.duration_minutes
            if item.status == StudyPlanItem.Status.COMPLETED:
                completed_count += 1
                completed_minutes += item.duration_minutes
            if item.scheduled_date == today:
                today_count += 1
                today_minutes += item.duration_minutes
        return Response(
            {
                "from": start,
                "to": end,
                "count": len(items),
                "summary": {
                    "planned_count": len(items),
                    "completed_count": completed_count,
                    "planned_minutes": planned_minutes,
                    "completed_minutes": completed_minutes,
                    "today_count": today_count,
                    "today_minutes": today_minutes,
                },
                "results": [study_plan_item_payload(item) for item in items],
            }
        )


class StudyPlanItemCollectionView(APIView):
    def post(self, request: Request) -> Response:
        serializer = StudyPlanItemWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = StudyPlanItem.objects.create(user=_user(request), **serializer.validated_data)
        return Response(study_plan_item_payload(item), status=status.HTTP_201_CREATED)


class StudyPlanItemDetailView(APIView):
    def _item(self, request: Request, item_id: UUID) -> StudyPlanItem:
        return get_object_or_404(StudyPlanItem, id=item_id, user=_user(request))

    def patch(self, request: Request, item_id: UUID) -> Response:
        item = self._item(request, item_id)
        serializer = StudyPlanItemUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(item, field, value)
        if "status" in serializer.validated_data:
            item.completed_at = (
                timezone.now() if item.status == StudyPlanItem.Status.COMPLETED else None
            )
        item.save()
        return Response(study_plan_item_payload(item))

    def delete(self, request: Request, item_id: UUID) -> Response:
        self._item(request, item_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

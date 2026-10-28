from uuid import UUID

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import StudyPlanItem
from .serializers import (
    StudyPlanGenerateSerializer,
    StudyPlanItemUpdateSerializer,
    StudyPlanItemWriteSerializer,
    StudyPlanPreviewSerializer,
    StudyPlanProfileWriteSerializer,
    StudyPlanRangeSerializer,
    study_plan_item_payload,
)
from .services import (
    PlanChanged,
    beginner_progress,
    generate_plan,
    plan_today,
    preview_plan,
    profile_for,
    profile_payload,
    save_profile,
    validate_day,
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
        user = _user(request)
        profile = profile_for(user)
        items = list(
            StudyPlanItem.objects.filter(
                user=user,
                scheduled_date__range=(start, end),
            )
        )
        today = plan_today(profile)
        overdue = StudyPlanItem.objects.filter(
            user=user, status="planned", scheduled_date__lt=today
        )
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
                "today": today,
                "profile": profile_payload(profile),
                "progress": beginner_progress(user, today),
                "overdue_count": overdue.count(),
                "overdue": [study_plan_item_payload(item) for item in overdue[:20]],
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
    @transaction.atomic
    def post(self, request: Request) -> Response:
        serializer = StudyPlanItemWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = _user(request)
        User.objects.select_for_update().get(pk=user.pk)
        request_id = serializer.validated_data.get("client_request_id")
        existing = (
            StudyPlanItem.objects.filter(user=user, client_request_id=request_id).first()
            if request_id
            else None
        )
        if existing:
            if any(
                getattr(existing, field) != value
                for field, value in serializer.validated_data.items()
            ):
                raise PlanChanged()
            return Response(study_plan_item_payload(existing))
        validate_day(
            user,
            serializer.validated_data["scheduled_date"],
            serializer.validated_data["duration_minutes"],
        )
        item = StudyPlanItem.objects.create(user=user, **serializer.validated_data)
        return Response(study_plan_item_payload(item), status=status.HTTP_201_CREATED)


class StudyPlanItemDetailView(APIView):
    def _item(self, request: Request, item_id: UUID) -> StudyPlanItem:
        return get_object_or_404(StudyPlanItem, id=item_id, user=_user(request))

    @transaction.atomic
    def patch(self, request: Request, item_id: UUID) -> Response:
        user = _user(request)
        User.objects.select_for_update().get(pk=user.pk)
        item = self._item(request, item_id)
        serializer = StudyPlanItemUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        changes = dict(serializer.validated_data)
        expected = changes.pop("expected_revision", item.revision)
        if expected != item.revision:
            raise PlanChanged()
        if not changes:
            raise ValidationError("Provide at least one field to update.")
        previous_status = item.status
        previous_date = item.scheduled_date
        previous_minutes = item.duration_minutes
        for field, value in changes.items():
            setattr(item, field, value)
        if item.scheduled_date != previous_date:
            item.generated_slot = None
        if item.status == StudyPlanItem.Status.COMPLETED and item.scheduled_date > plan_today(
            profile_for(user)
        ):
            raise ValidationError(
                {"status": "Future sessions cannot be completed yet."}, code="future_session"
            )
        # Only a move or a longer session can push a day past its cap; legacy days
        # that already exceed it must still allow completing or renaming a task.
        if item.scheduled_date != previous_date or item.duration_minutes > previous_minutes:
            validate_day(user, item.scheduled_date, item.duration_minutes, exclude=item.pk)
        if item.status != previous_status:
            item.completed_at = (
                timezone.now() if item.status == StudyPlanItem.Status.COMPLETED else None
            )
        item.revision += 1
        item.save()
        return Response(study_plan_item_payload(item))

    @transaction.atomic
    def delete(self, request: Request, item_id: UUID) -> Response:
        User.objects.select_for_update().get(pk=_user(request).pk)
        item = self._item(request, item_id)
        expected = request.query_params.get("revision")
        if expected is not None and expected != str(item.revision):
            raise PlanChanged()
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class StudyPlanProfileView(APIView):
    @extend_schema(request=StudyPlanProfileWriteSerializer, responses={200: OpenApiTypes.OBJECT})
    def patch(self, request: Request) -> Response:
        serializer = StudyPlanProfileWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(save_profile(_user(request), serializer.validated_data))


class StudyPlanPreviewView(APIView):
    @extend_schema(request=StudyPlanPreviewSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request: Request) -> Response:
        serializer = StudyPlanPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(preview_plan(_user(request), serializer.validated_data["start_date"]))


class StudyPlanGenerateView(APIView):
    @extend_schema(request=StudyPlanGenerateSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request: Request) -> Response:
        serializer = StudyPlanGenerateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            generate_plan(
                _user(request),
                serializer.validated_data["start_date"],
                serializer.validated_data["preview_token"],
            )
        )

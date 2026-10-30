from uuid import UUID

from django.conf import settings
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .learning_snapshot import exam_payload, student_exam_periods, student_learning_snapshot
from .reading_preview import reading_plan_preview
from .serializers import (
    PlanApplySerializer,
    ReadingEvidenceSerializer,
    ReadingPlanPreviewSerializer,
    TaskProgressSerializer,
)
from .views import _user


class StudyPlanV2Permission(BasePermission):
    message = "This feature is not available yet."

    def has_permission(self, request: Request, view: APIView) -> bool:
        if not getattr(settings, "STUDY_PLAN_V2_ENABLED", False):
            return False
        pilot_users = getattr(settings, "STUDY_PLAN_V2_USER_IDS", [])
        return not pilot_users or str(request.user.pk) in pilot_users


class StudyPlanV2View(APIView):
    # Extend rather than replace session auth, feature and subscription gates.
    permission_classes = (*APIView.permission_classes, StudyPlanV2Permission)


class StudentExamListView(StudyPlanV2View):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request) -> Response:
        periods = student_exam_periods(user=_user(request))[:50]
        return Response(
            {
                "enabled": True,
                "schema_version": 1,
                "results": [exam_payload(period) for period in periods],
            }
        )


class StudentLearningSnapshotView(StudyPlanV2View):
    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, period_id: UUID) -> Response:
        user = _user(request)
        period = get_object_or_404(
            student_exam_periods(user=user).select_related("institution"), pk=period_id
        )
        return Response(student_learning_snapshot(user=user, period=period))


class StudentReadingPlanPreviewView(StudyPlanV2View):
    @extend_schema(request=ReadingPlanPreviewSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request: Request, period_id: UUID) -> Response:
        user = _user(request)
        period = get_object_or_404(
            student_exam_periods(user=user).select_related("institution"), pk=period_id
        )
        serializer = ReadingPlanPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        from .task_progress import reconcile_review_tasks

        reconcile_review_tasks(user)
        return Response(reading_plan_preview(user=user, period=period, **serializer.validated_data))


class StudentPlanApplyView(StudyPlanV2View):
    @extend_schema(request=PlanApplySerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request: Request, period_id: UUID) -> Response:
        from .apply_preview import apply_preview

        user = _user(request)
        from .models import PlannerRun

        serializer = PlanApplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        receipt = (
            PlannerRun.objects.filter(
                user=user,
                period_id=period_id,
                client_request_id=serializer.validated_data["client_request_id"],
            )
            .select_related("period")
            .first()
        )
        period = (
            receipt.period
            if receipt
            else get_object_or_404(student_exam_periods(user=user), pk=period_id)
        )
        return Response(apply_preview(user=user, period=period, **serializer.validated_data))


class StudentReadingProgressView(StudyPlanV2View):
    @extend_schema(request=ReadingEvidenceSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request: Request, period_id: UUID) -> Response:
        from .evidence import report_progress
        from .serializers import ReadingEvidenceSerializer

        user = _user(request)
        period = get_object_or_404(student_exam_periods(user=user), pk=period_id)
        serializer = ReadingEvidenceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            report_progress(
                user=user, task=None, data={**serializer.validated_data, "period": period}
            )
        )


class StudentTaskProgressView(StudyPlanV2View):
    @extend_schema(request=TaskProgressSerializer, responses={200: OpenApiTypes.OBJECT})
    def post(self, request: Request, item_id: UUID) -> Response:
        from .evidence import report_progress
        from .models import StudyPlanItem
        from .serializers import TaskProgressSerializer

        user = _user(request)
        task = get_object_or_404(
            StudyPlanItem.objects.select_related("planner_run"),
            user=user,
            pk=item_id,
            planner_run__isnull=False,
        )
        if task.planner_run is None:
            from rest_framework.exceptions import NotFound

            raise NotFound()
        period = get_object_or_404(student_exam_periods(user=user), pk=task.planner_run.period_id)
        serializer = TaskProgressSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(
            report_progress(
                user=user, task=task, data={**serializer.validated_data, "period": period}
            )
        )



class StudentPlanChangesView(StudyPlanV2View):
    """Read-only check: notify about material changes without rewriting saved tasks."""

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request: Request, period_id: UUID) -> Response:
        from .models import PlannerRun, StudyPlanItem
        from .question_preview import published_question_fingerprint
        from .services import plan_today, profile_for

        user = _user(request)
        period = get_object_or_404(student_exam_periods(user=user), pk=period_id)
        run = PlannerRun.objects.filter(
            user=user, period=period
        ).order_by("-created_at", "-id").first()
        if run is None:
            return Response({"has_plan": False, "needs_review": False, "reasons": []})
        snapshot = student_learning_snapshot(user=user, period=period)
        before = run.result
        reasons = []
        if not before.get("syllabus_fingerprint"):
            reasons.append("untracked_baseline")
        elif before["syllabus_fingerprint"] != snapshot["syllabus_fingerprint"]:
            reasons.append("syllabus_changed")
        if before.get("includes_questions"):
            sheet_ids = [
                sheet["sheet_id"] for subject in snapshot["subjects"]
                for sheet in subject["sheets"]
            ]
            if before.get("question_fingerprint") != published_question_fingerprint(sheet_ids):
                reasons.append("questions_changed")
        today = plan_today(profile_for(user))
        if StudyPlanItem.objects.filter(
            user=user, planner_run__period=period,
            scheduled_date__lt=today, status="planned",
        ).exists():
            reasons.append("overdue_work")
        return Response({
            "has_plan": True, "needs_review": bool(reasons),
            "reasons": reasons,
            "last_applied": run.created_at.isoformat(),
        })

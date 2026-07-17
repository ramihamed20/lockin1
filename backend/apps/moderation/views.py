from typing import NoReturn
from uuid import UUID

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import APIException, NotFound, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import Report
from .pagination import AuditCursorPagination, ReportCursorPagination
from .permissions import HasModerationWorkspace
from .policies import can_access_moderation_tools, can_manage_report
from .selectors import audit_for_user, report_for_user, reports_for_user
from .serializers import (
    ModerationAuditSerializer,
    ModeratorReportSerializer,
    ReportAssignSerializer,
    ReportSerializer,
    ReportTransitionSerializer,
    ReportWriteSerializer,
)
from .services import (
    ModerationConflictError,
    ModerationRateLimitError,
    ModerationRuleError,
    assign_report,
    create_report,
    transition_report,
)


class ModerationRejected(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "moderation_rule_rejected"


class ModerationConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "moderation_revision_conflict"


class ModerationThrottled(APIException):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_code = "moderation_rate_limited"


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _raise_service(error: Exception) -> NoReturn:
    if isinstance(error, ModerationConflictError):
        raise ModerationConflict(str(error)) from error
    if isinstance(error, ModerationRateLimitError):
        raise ModerationThrottled(str(error)) from error
    if isinstance(error, ModerationRuleError):
        message = str(error)
        if message.startswith("You cannot"):
            raise PermissionDenied(message) from error
        raise ModerationRejected(message) from error
    raise error


def _serializer_for(*, user: User) -> type[ReportSerializer] | type[ModeratorReportSerializer]:
    return ModeratorReportSerializer if can_access_moderation_tools(user=user) else ReportSerializer


class ReportListView(APIView):
    def get(self, request: Request) -> Response:
        queryset = reports_for_user(user=_user(request))
        report_status = request.query_params.get("status")
        target_type = request.query_params.get("target_type")
        assignment = request.query_params.get("assignment")
        if report_status:
            if report_status not in Report.Status.values:
                raise ModerationRejected("Unsupported report status.")
            queryset = queryset.filter(status=report_status)
        if target_type:
            if target_type not in Report.TargetType.values:
                raise ModerationRejected("Unsupported report target.")
            queryset = queryset.filter(target_type=target_type)
        if assignment == "mine":
            queryset = queryset.filter(assigned_to=_user(request))
        elif assignment == "unassigned":
            queryset = queryset.filter(assigned_to__isnull=True)
        paginator = ReportCursorPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer_class = _serializer_for(user=_user(request))
        return paginator.get_paginated_response(
            serializer_class(page, many=True, context={"request": request}).data
        )

    def post(self, request: Request) -> Response:
        serializer = ReportWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            report = create_report(
                reporter=_user(request),
                target_type=str(data["target_type"]),
                target_id=data["target_id"],
                reason=str(data["reason"]),
                description=str(data["description"]),
                client_request_id=data["client_request_id"],
            )
        except (ModerationRuleError, ModerationConflictError, ModerationRateLimitError) as error:
            _raise_service(error)
        serializer_class = _serializer_for(user=_user(request))
        return Response(
            serializer_class(report, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class ReportDetailView(APIView):
    def get(self, request: Request, report_id: UUID) -> Response:
        try:
            report = report_for_user(user=_user(request), report_id=report_id)
        except Report.DoesNotExist as error:
            raise NotFound("Report not found.") from error
        serializer_class = _serializer_for(user=_user(request))
        return Response(serializer_class(report, context={"request": request}).data)


class ReportAssignView(APIView):
    permission_classes = [HasModerationWorkspace]

    def post(self, request: Request, report_id: UUID) -> Response:
        serializer = ReportAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actor = _user(request)
        try:
            visible_report = report_for_user(user=actor, report_id=report_id)
        except Report.DoesNotExist as error:
            raise NotFound("Report not found.") from error
        if not can_manage_report(user=actor, report=visible_report):
            raise PermissionDenied("You cannot assign this report.")
        assignee = get_object_or_404(
            User,
            id=serializer.validated_data["assignee_id"],
            is_active=True,
        )
        try:
            report = assign_report(
                actor=actor,
                report_id=report_id,
                expected_revision=int(serializer.validated_data["expected_revision"]),
                assignee=assignee,
            )
        except (Report.DoesNotExist, ModerationRuleError, ModerationConflictError) as error:
            if isinstance(error, Report.DoesNotExist):
                raise NotFound("Report not found.") from error
            _raise_service(error)
        return Response(ModeratorReportSerializer(report, context={"request": request}).data)


class ReportTransitionView(APIView):
    permission_classes = [HasModerationWorkspace]

    def post(self, request: Request, report_id: UUID) -> Response:
        serializer = ReportTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            report = transition_report(
                actor=_user(request),
                report_id=report_id,
                expected_revision=int(data["expected_revision"]),
                status=str(data["status"]),
                resolution_notes=str(data.get("resolution_notes", "")),
                duplicate_of_id=data.get("duplicate_of_id"),
                content_action=data.get("content_action"),
            )
        except (Report.DoesNotExist, ModerationRuleError, ModerationConflictError) as error:
            if isinstance(error, Report.DoesNotExist):
                raise NotFound("Report not found.") from error
            _raise_service(error)
        return Response(ModeratorReportSerializer(report, context={"request": request}).data)


class ModerationAuditView(APIView):
    permission_classes = [HasModerationWorkspace]

    def get(self, request: Request) -> Response:
        paginator = AuditCursorPagination()
        page = paginator.paginate_queryset(audit_for_user(user=_user(request)), request, view=self)
        return paginator.get_paginated_response(ModerationAuditSerializer(page, many=True).data)

"""Requests to change an added First Year subject, and their operator inbox."""

from uuid import UUID

from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability
from platform_core.api.exceptions import RequestRejected
from platform_core.api.pagination import LockinPagination

from .added_subjects import (
    AddedSubjectError,
    added_subject_payload,
    change_request_payload,
    decide_change,
    request_change,
)
from .models import AddedSubjectChangeRequest


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


def _rejected(error: AddedSubjectError) -> Exception:
    if error.code == "not_found":
        return NotFound(str(error))
    return RequestRejected(str(error), code=error.code)


class AddedSubjectChangeRequestCollectionView(APIView):
    def get(self, request: Request) -> Response:
        items = AddedSubjectChangeRequest.objects.filter(user=_user(request)).select_related(
            "remove_subject", "add_subject"
        )[:20]
        return Response({"results": [change_request_payload(item) for item in items]})

    def post(self, request: Request) -> Response:
        user = _user(request)
        remove_slug = str(request.data.get("remove", "")).strip()
        add_slug = str(request.data.get("add", "")).strip()
        if not remove_slug or not add_slug:
            raise ValidationError({"remove": "Choose both subjects."})
        try:
            request_change(
                user=user,
                remove_slug=remove_slug,
                add_slug=add_slug,
                note=str(request.data.get("note", "")),
            )
        except AddedSubjectError as error:
            raise _rejected(error) from error
        return Response(added_subject_payload(user), status=status.HTTP_201_CREATED)


def _admin_payload(item: AddedSubjectChangeRequest) -> dict[str, object]:
    payload = change_request_payload(item)
    payload["user"] = {
        "id": str(item.user_id),
        "name": item.user.full_name,
        "email": item.user.email,
    }
    return payload


class AdminAddedSubjectRequestListView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.MODERATION_VIEW

    def get(self, request: Request) -> Response:
        queryset = AddedSubjectChangeRequest.objects.select_related(
            "user", "remove_subject", "add_subject"
        )
        status_filter = request.query_params.get("status", "")
        if status_filter in AddedSubjectChangeRequest.Status.values:
            queryset = queryset.filter(status=status_filter)
        paginator = LockinPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response([_admin_payload(item) for item in page or []])


class AdminAddedSubjectRequestDecisionView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.MODERATION_MANAGE

    def post(self, request: Request, request_id: UUID) -> Response:
        decision = str(request.data.get("decision", ""))
        if decision not in {"approve", "decline"}:
            raise ValidationError({"decision": "Choose approve or decline."})
        try:
            item = decide_change(
                request_id=request_id,
                approve=decision == "approve",
                actor=_user(request),
                admin_note=str(request.data.get("admin_note", "")),
            )
        except AddedSubjectError as error:
            raise _rejected(error) from error
        return Response(_admin_payload(item))

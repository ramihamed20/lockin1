from uuid import UUID

from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.rate_limits import AttemptBudget, reserve_attempts
from apps.accounts.services import auth_attempt_fingerprint
from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability
from platform_core.api.pagination import LockinPagination
from platform_core.network import client_ip

from .models import FeedbackSuggestion
from .serializers import (
    FeedbackCreateSerializer,
    FeedbackUpdateSerializer,
    admin_feedback_payload,
    own_feedback_payload,
)


def _user(request: Request) -> User:
    if not isinstance(request.user, User):
        raise PermissionDenied()
    return request.user


class FeedbackCollectionView(APIView):
    def get(self, request: Request) -> Response:
        items = FeedbackSuggestion.objects.filter(user=_user(request))[:50]
        return Response({"results": [own_feedback_payload(item) for item in items]})

    def post(self, request: Request) -> Response:
        user = _user(request)
        serializer = FeedbackCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        window = int(getattr(settings, "FEEDBACK_RATE_WINDOW_SECONDS", 3600))
        limit = int(getattr(settings, "FEEDBACK_RATE_LIMIT", 5))
        reserved = reserve_attempts(
            [
                AttemptBudget(
                    "feedback",
                    auth_attempt_fingerprint(
                        scope="feedback",
                        identifier=str(user.id),
                        remote_address=client_ip(request),
                    ),
                    window,
                    limit,
                ),
                AttemptBudget(
                    "feedback_account",
                    auth_attempt_fingerprint(
                        scope="feedback_account", identifier=str(user.id), remote_address=""
                    ),
                    window,
                    limit,
                ),
            ]
        )
        if reserved is None:
            return Response(
                {"detail": "Too many suggestions. Try again later.", "code": "rate_limited"},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        item = FeedbackSuggestion.objects.create(user=user, **serializer.validated_data)
        return Response(own_feedback_payload(item), status=status.HTTP_201_CREATED)


class AdminFeedbackListView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.MODERATION_VIEW

    def get(self, request: Request) -> Response:
        queryset = FeedbackSuggestion.objects.select_related("user")
        status_filter = request.query_params.get("status", "")
        if status_filter in FeedbackSuggestion.Status.values:
            queryset = queryset.filter(status=status_filter)
        paginator = LockinPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response(
            [admin_feedback_payload(item) for item in page or []]
        )


class AdminFeedbackDetailView(APIView):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.MODERATION_MANAGE

    def patch(self, request: Request, feedback_id: UUID) -> Response:
        try:
            item = FeedbackSuggestion.objects.select_related("user").get(id=feedback_id)
        except FeedbackSuggestion.DoesNotExist as error:
            raise NotFound("Suggestion not found.") from error
        serializer = FeedbackUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(item, field, value)
        item.save()
        return Response(admin_feedback_payload(item))

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from django.db.models import Count, Max, QuerySet, Sum
from django.db.models.functions import Coalesce

from .models import FocusAnnotation, FocusAnnotationCollection, FocusSession, FocusWorkspaceSnapshot


@dataclass(frozen=True, slots=True)
class FocusSummary:
    completed_sessions: int
    active_seconds: int
    last_completed_at: datetime | None


def get_focus_summary(*, user_id: UUID) -> FocusSummary:
    values = FocusSession.objects.filter(
        user_id=user_id, status=FocusSession.Status.COMPLETED
    ).aggregate(
        completed_sessions=Count("id"),
        active_seconds=Coalesce(Sum("active_duration_seconds"), 0),
        last_completed_at=Max("ended_at"),
    )
    return FocusSummary(
        completed_sessions=int(values["completed_sessions"]),
        active_seconds=int(values["active_seconds"]),
        last_completed_at=values["last_completed_at"],
    )


def focus_session_history(*, user_id: UUID) -> QuerySet[FocusSession]:
    return (
        FocusSession.objects.filter(user_id=user_id)
        .select_related("workspace")
        .order_by("-started_at", "-id")
    )


def latest_workspace(*, user_id: UUID, document_version_id: UUID) -> FocusWorkspaceSnapshot | None:
    return (
        FocusWorkspaceSnapshot.objects.filter(
            user_id=user_id,
            document_version_id=document_version_id,
        )
        .select_related("session")
        .order_by("-updated_at")
        .first()
    )


def annotations_for_pages(
    *, user_id: UUID, document_version_id: UUID, page_numbers: tuple[int, ...]
) -> tuple[int, QuerySet[FocusAnnotation]]:
    collection = FocusAnnotationCollection.objects.filter(
        user_id=user_id,
        document_version_id=document_version_id,
    ).first()
    if collection is None:
        return 0, FocusAnnotation.objects.none()
    return (
        collection.revision,
        collection.annotations.filter(
            page_number__in=page_numbers,
            deleted_at__isnull=True,
        ).order_by("page_number", "created_at", "id"),
    )

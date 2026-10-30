from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from django.db.models import Count, F, Max, Q, QuerySet, Sum, Window
from django.db.models.functions import Coalesce, RowNumber

from .models import (
    ActiveStudyRun,
    FocusAnnotation,
    FocusAnnotationCollection,
    FocusSession,
    FocusSessionParticipant,
    FocusWorkspaceSnapshot,
)


def planning_active_study_evidence(
    *, user_id: UUID, sheet_ids: list[UUID]
) -> dict[UUID, list[dict[str, object]]]:
    """Aggregate scoring once, without loading answer bodies or certifying mastery.

    Existing runs do not pin an immutable PDF version. Their evidence remains
    useful history, but must not automatically complete a version-specific task.
    """
    grouped: dict[UUID, list[dict[str, object]]] = {}
    rows = (
        ActiveStudyRun.objects.filter(user_id=user_id, sheet_id__in=sheet_ids)
        .values("sheet_id", "edition", "difficulty")
        .annotate(
            run_count=Count("id", distinct=True),
            submitted_attempts=Count("attempts", filter=Q(attempts__submitted_at__isnull=False)),
            correct=Sum("attempts__score", filter=Q(attempts__submitted_at__isnull=False)),
            total=Sum("attempts__total", filter=Q(attempts__submitted_at__isnull=False)),
            last_activity_at=Max("updated_at"),
        )
    )
    for row in rows:
        sheet_id = row.pop("sheet_id")
        grouped.setdefault(sheet_id, []).append({**row, "version_verified": False})
    return grouped


def planning_reader_positions(
    *, user_id: UUID, version_ids: list[UUID]
) -> dict[UUID, list[dict[str, object]]]:
    grouped: dict[UUID, list[dict[str, object]]] = {}
    latest = (
        FocusWorkspaceSnapshot.objects.filter(
            user_id=user_id,
            document_version_id__in=version_ids,
        )
        .annotate(
            position_rank=Window(
                expression=RowNumber(),
                partition_by=[F("document_version_id"), F("file_id")],
                order_by=[F("updated_at").desc(), F("id").desc()],
            )
        )
        .filter(position_rank=1)
        .values(
            "document_version_id",
            "file_id",
            "current_page",
            "updated_at",
        )
    )
    for row in latest:
        grouped.setdefault(row["document_version_id"], []).append(
            {
                "file_id": str(row["file_id"]),
                "page": row["current_page"],
                "updated_at": row["updated_at"],
                "version_verified": True,
                "source": "focus_workspace",
            }
        )
    return grouped


@dataclass(frozen=True, slots=True)
class FocusSummary:
    completed_sessions: int
    active_seconds: int
    last_completed_at: datetime | None


def get_focus_summary(*, user_id: UUID) -> FocusSummary:
    values = (
        FocusSession.objects.filter(user_id=user_id, status=FocusSession.Status.COMPLETED)
        .exclude(experience_version=2, team__isnull=False)
        .aggregate(
            completed_sessions=Count("id"),
            active_seconds=Coalesce(Sum("active_duration_seconds"), 0),
            last_completed_at=Max("ended_at"),
        )
    )
    shared = FocusSessionParticipant.objects.filter(
        user_id=user_id,
        credited_at__isnull=False,
        active_microseconds__gt=0,
    ).aggregate(
        count=Count("id"), micros=Coalesce(Sum("active_microseconds"), 0), last=Max("credited_at")
    )
    dates = [value for value in [values["last_completed_at"], shared["last"]] if value]
    return FocusSummary(
        completed_sessions=int(values["completed_sessions"]) + int(shared["count"]),
        active_seconds=int(values["active_seconds"]) + int(shared["micros"]) // 1_000_000,
        last_completed_at=max(dates) if dates else None,
    )


def focus_session_history(*, user_id: UUID) -> QuerySet[FocusSession]:
    return (
        FocusSession.objects.filter(user_id=user_id)
        .select_related("workspace")
        .order_by("-started_at", "-id")
    )


def latest_workspace(*, user_id: UUID, document_id: UUID) -> FocusWorkspaceSnapshot | None:
    """The reader's last position in one document.

    Keyed by document rather than by version: one version now publishes two
    editions and their summaries, and a page number in one of them means nothing
    in another.
    """

    return (
        FocusWorkspaceSnapshot.objects.filter(
            user_id=user_id,
            document_id=document_id,
        )
        .select_related("session")
        .order_by("-updated_at")
        .first()
    )


def annotations_for_pages(
    *, user_id: UUID, document_id: UUID, page_numbers: tuple[int, ...]
) -> tuple[int, QuerySet[FocusAnnotation]]:
    collection = FocusAnnotationCollection.objects.filter(
        user_id=user_id,
        document_id=document_id,
        merged_into__isnull=True,
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


def annotation_collection_revision(*, user_id: UUID, document_id: UUID) -> int:
    revision = (
        FocusAnnotationCollection.objects.filter(
            user_id=user_id,
            document_id=document_id,
            merged_into__isnull=True,
        )
        .values_list("revision", flat=True)
        .first()
    )
    return int(revision or 0)

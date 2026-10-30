from datetime import datetime
from uuid import UUID

from django.db.models import Count, Max, Q, QuerySet
from django.utils import timezone

from apps.accounts.models import User

from .models import (
    MistakeEvent,
    ReviewAnswerLog,
    ReviewItem,
    WeeklyRecallSession,
)
from .policy import iso_week_key, iso_week_start


def planning_review_summary(
    *,
    user: User,
    node_ids: list[UUID],
    material_slug: str,
    sheet_ids: list[UUID],
    now: datetime,
) -> dict[str, object]:
    """Subject-level Review Bank evidence, with no question or answer payloads."""
    keys = [f"catalog:{material_slug}"]
    keys.extend(f"{prefix}:{node_id}" for prefix in ("node", "content") for node_id in node_ids)
    return (
        ReviewItem.objects.filter(user=user, state=ReviewItem.State.ACTIVE)
        .filter(
            Q(subject_id__in=node_ids)
            | Q(subject__isnull=True, subject_key__in=keys)
            | Q(source_id__in=[str(sheet_id) for sheet_id in sheet_ids])
        )
        .aggregate(
            active_count=Count("id"),
            due_count=Count("id", filter=Q(next_review_at__lte=now)),
            repeated_mistakes=Count("id", filter=Q(mistake_count__gt=1)),
        )
    )


def due_review_count(*, user: User, now: datetime) -> int:
    """Count usable, active personal mistakes without exposing question content."""
    return (
        ReviewItem.objects.filter(user=user, state=ReviewItem.State.ACTIVE, next_review_at__lte=now)
        .exclude(options_snapshot=[])
        .exclude(correct_option_ids_snapshot=[])
        .count()
    )


def latest_mistakes(*, user: User, limit: int = 4) -> QuerySet[MistakeEvent]:
    return (
        MistakeEvent.objects.filter(user=user)
        .select_related("review_item", "review_item__subject")
        .order_by("-answered_at", "-created_at", "id")[:limit]
    )


def active_review_items(*, user: User, subject_key: str) -> QuerySet[ReviewItem]:
    return (
        ReviewItem.objects.filter(
            user=user,
            state=ReviewItem.State.ACTIVE,
            subject_key=subject_key,
        )
        .select_related("subject", "last_question_version")
        .order_by(
            "-mistake_count",
            "-review_incorrect_count",
            "last_mistake_at",
            "canonical_key",
        )
    )


def all_active_review_items(*, user: User) -> QuerySet[ReviewItem]:
    """Every active item, in the order each subject's review session uses."""

    return (
        ReviewItem.objects.filter(user=user, state=ReviewItem.State.ACTIVE)
        .select_related("subject", "last_question_version")
        .order_by(
            "subject_key",
            "-mistake_count",
            "-review_incorrect_count",
            "last_mistake_at",
            "canonical_key",
        )
    )


def review_bank_overview(*, user: User, now: datetime | None = None) -> dict[str, object]:
    checked_at = now or timezone.now()
    active = ReviewItem.objects.filter(user=user, state=ReviewItem.State.ACTIVE)
    subjects = list(
        active.values("subject_key", "subject_label_snapshot")
        .annotate(
            question_count=Count("id"),
            repeated_count=Count("id", filter=Q(mistake_count__gt=1)),
            last_mistake_at=Max("last_mistake_at"),
        )
        .order_by("-question_count", "subject_label_snapshot", "subject_key")
    )
    active_count = sum(int(subject["question_count"]) for subject in subjects)
    mastered_this_week = (
        ReviewAnswerLog.objects.filter(
            user=user,
            was_correct=True,
            answered_at__gte=iso_week_start(checked_at),
        )
        .values("review_item_id")
        .distinct()
        .count()
    )
    return {
        "active_count": active_count,
        "mastered_this_week": mastered_this_week,
        "subjects": subjects,
    }


def current_weekly_session(
    *, user: User, now: datetime | None = None
) -> WeeklyRecallSession | None:
    checked_at = now or timezone.now()
    return (
        WeeklyRecallSession.objects.filter(user=user, week_key=iso_week_key(checked_at))
        .prefetch_related("questions__review_item")
        .first()
    )


def weekly_recall_eligible_count(*, user: User) -> int:
    return ReviewItem.objects.filter(
        user=user,
        state__in=(ReviewItem.State.HIDDEN, ReviewItem.State.MASTERED),
    ).count()

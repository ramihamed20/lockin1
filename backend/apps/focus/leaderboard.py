"""Cohort-scoped Lockin rankings from completed sessions and immutable scores.

A sheet is counted once per ranking entry after a passed final submitted during
one of its completed Lockin sessions. Opening a PDF is never completion evidence.
"""

import hashlib
from datetime import timedelta
from typing import Any
from uuid import UUID

from django.db.models import (
    Count,
    DateTimeField,
    DurationField,
    Exists,
    ExpressionWrapper,
    F,
    FloatField,
    IntegerField,
    OuterRef,
    Q,
    Subquery,
    Sum,
    Value,
)
from django.db.models.functions import Cast, Coalesce, NullIf
from django.utils import timezone

from apps.accounts.avatars import avatar_payload
from apps.accounts.models import User

from .models import ActiveStudyAttempt, FocusSession, FocusSessionActivity, FocusTeam

ACCURACY_MIN_ANSWERS = 20


def completed_sessions(period: str, cohort_id: UUID | None) -> Any:
    sessions = FocusSession.objects.filter(status="completed", user__cohort_id=cohort_id)
    if period == "weekly":
        sessions = sessions.filter(ended_at__date__gte=timezone.localdate() - timedelta(days=6))
    return sessions


def _score_totals(period: str, cohort_id: UUID | None, *, team: bool) -> Any:
    sessions = completed_sessions(period, cohort_id).filter(
        started_at__lte=OuterRef("submitted_at"), ended_at__gte=OuterRef("submitted_at")
    )
    if team:
        sessions = sessions.filter(team_id=OuterRef(OuterRef("pk"))).filter(
            Q(user_id=OuterRef("run__user_id"))
            | (
                Q(participants__user_id=OuterRef("run__user_id"))
                & Q(participants__joined_at__lte=OuterRef("submitted_at"))
                & (
                    Q(participants__left_at__isnull=True)
                    | Q(participants__left_at__gte=OuterRef("submitted_at"))
                )
            )
        )
    else:
        sessions = sessions.filter(
            team__isnull=True,
            user_id=OuterRef(OuterRef("pk")),
            user_id__exact=OuterRef("run__user_id"),
        )
    attempts = ActiveStudyAttempt.objects.filter(
        run__user__cohort_id=cohort_id,
        submitted_at__isnull=False,
        score__isnull=False,
        total__gt=0,
    ).filter(Exists(sessions))
    return (
        attempts.order_by()
        .annotate(group=Value(1))
        .values("group")
        .annotate(
            correct=Sum("score"),
            answered=Sum("total"),
            sheets=Count("run__sheet_id", distinct=True, filter=Q(kind="final", passed=True)),
        )
    )


def _annotate_metrics(rows: Any, period: str, cohort_id: UUID | None, *, team: bool) -> Any:
    sessions = completed_sessions(period, cohort_id)
    sessions = (
        sessions.filter(team_id=OuterRef("pk"))
        if team
        else sessions.filter(team__isnull=True, user_id=OuterRef("pk"))
    )
    totals = (
        sessions.order_by()
        .annotate(group=Value(1))
        .values("group")
        .annotate(total=Sum("active_duration_seconds"))
    )
    scores = _score_totals(period, cohort_id, team=team)
    return rows.annotate(
        total_active_seconds=Coalesce(
            Subquery(totals.values("total"), output_field=IntegerField()), 0
        ),
        correct_answers=Coalesce(
            Subquery(scores.values("correct"), output_field=IntegerField()), 0
        ),
        answered_count=Coalesce(
            Subquery(scores.values("answered"), output_field=IntegerField()), 0
        ),
        completed_sheets=Coalesce(
            Subquery(scores.values("sheets"), output_field=IntegerField()), 0
        ),
    ).annotate(
        accuracy=Cast(F("correct_answers"), FloatField())
        * 100.0
        / NullIf(F("answered_count"), Value(0))
    )


def _longest_span(period: str, cohort_id: UUID | None) -> Any:
    next_event = (
        FocusSessionActivity.objects.filter(
            session_id=OuterRef("session_id"), sequence__gt=OuterRef("sequence")
        )
        .order_by("sequence")
        .values("occurred_at")[:1]
    )
    return (
        FocusSessionActivity.objects.filter(
            session__in=completed_sessions(period, cohort_id).filter(team__isnull=True),
            session__user_id=OuterRef("pk"),
            activity_type__in=("started", "resumed", "break_ended"),
        )
        .annotate(
            span=ExpressionWrapper(
                Coalesce(Subquery(next_event, output_field=DateTimeField()), F("session__ended_at"))
                - F("occurred_at"),
                output_field=DurationField(),
            )
        )
        .filter(span__gt=timedelta(0))
        .order_by("-span")
        .values("span")[:1]
    )


def rankings(*, period: str, metric: str, cohort_id: UUID | None) -> dict[str, object]:
    teams = _annotate_metrics(
        FocusTeam.objects.filter(cohort_id=cohort_id).annotate(
            member_total=Count("memberships", distinct=True)
        ),
        period,
        cohort_id,
        team=True,
    ).filter(total_active_seconds__gt=0)
    solo = (
        _annotate_metrics(
            User.objects.filter(cohort_id=cohort_id),
            period,
            cohort_id,
            team=False,
        )
        .annotate(
            longest_span=Subquery(_longest_span(period, cohort_id), output_field=DurationField()),
            hide_identity=Exists(
                FocusSession.objects.filter(
                    team__isnull=True,
                    anonymous=True,
                    user_id=OuterRef("pk"),
                    **(
                        {"started_at__date__gte": timezone.localdate() - timedelta(days=6)}
                        if period == "weekly"
                        else {}
                    ),
                )
            ),
        )
        .filter(
            Exists(
                completed_sessions(period, cohort_id).filter(
                    user_id=OuterRef("pk"), team__isnull=True
                )
            )
        )
    )
    if metric == "accuracy":
        teams = teams.filter(answered_count__gte=ACCURACY_MIN_ANSWERS)
        solo = solo.filter(answered_count__gte=ACCURACY_MIN_ANSWERS)
        team_order = solo_order = "-accuracy"
    else:
        team_order = "-completed_sheets" if metric == "sheets" else "-total_active_seconds"
        solo_order = "-longest_span" if metric == "continuous" else "-total_active_seconds"
        if metric == "sheets":
            teams = teams.filter(completed_sheets__gt=0)
        if metric == "continuous":
            solo = solo.filter(longest_span__isnull=False)

    def metrics(row: Any) -> dict[str, object]:
        return {
            "active_seconds": row.total_active_seconds,
            "weekly_active_seconds": row.total_active_seconds,
            "completed_sheets": row.completed_sheets,
            "answered_count": row.answered_count,
            "accuracy_percent": round(row.accuracy, 1) if row.answered_count else None,
        }

    return {
        "teams": [
            {
                "id": str(row.pk),
                "name": row.name,
                "member_count": row.member_total,
                "image_url": f"/api/v1/files/{row.image_id}/view" if row.image_id else None,
                **metrics(row),
            }
            for row in teams.order_by(team_order, "-total_active_seconds", "name", "pk")[:10]
        ],
        "solo": [
            {
                "id": hashlib.sha256(str(row.pk).encode()).hexdigest()[:16],
                "name": (
                    f"Anonymous {hashlib.sha256(str(row.pk).encode()).hexdigest()[:4].upper()}"
                    if row.hide_identity
                    else row.full_name
                ),
                "anonymous": row.hide_identity,
                "avatar": None if row.hide_identity else avatar_payload(row),
                "longest_focus_seconds": int(row.longest_span.total_seconds())
                if row.longest_span
                else None,
                **metrics(row),
            }
            for row in solo.order_by(solo_order, "-total_active_seconds", "pk")[:10]
        ],
        "accuracy_min_answers": ACCURACY_MIN_ANSWERS,
        "metric": metric,
        "period": period,
    }

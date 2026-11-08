"""Bounded daily projection. Selection changes; grading and schedule stay owned by Review."""

from datetime import datetime, timedelta
from statistics import median
from typing import Any

from django.db.models import Case, DateField, F, Value, When

from apps.accounts.models import User

from .models import ReviewAnswerLog
from .selectors import daily_review_items
from .serializers import review_item_payload


def daily_review_payload(*, user: User, now: datetime) -> dict[str, Any]:
    from apps.study_plans.review_priorities import review_exam_dates

    due = daily_review_items(user=user, now=now)
    exam_dates = review_exam_dates(
        user=user,
        now=now,
        subject_keys=due.order_by().values_list("subject_key", flat=True).distinct(),
    )
    if exam_dates:
        due = due.annotate(
            exam_on=Case(
                *(When(subject_key=key, then=Value(day)) for key, day in exam_dates.items()),
                default=Value(None),
                output_field=DateField(),
            )
        ).order_by(
            F("exam_on").asc(nulls_last=True),
            "-mistake_count",
            "-review_incorrect_count",
            "-is_unsure",
            "next_review_at",
            "id",
        )
    times = [
        int(value)
        for value in ReviewAnswerLog.objects.filter(
            user=user,
            answered_at__gte=now - timedelta(days=60),
            answered_at__lte=now,
            active_seconds__gte=5,
            active_seconds__lte=300,
        )
        .order_by("-answered_at", "-id")
        .values_list("active_seconds", flat=True)[:40]
        if value is not None
    ]
    personalized = len(times) >= 5
    seconds = max(15, min(120, round(median(times)))) if personalized else 30
    results = []
    for item in due[:20]:
        row = review_item_payload(item)
        reasons: list[str] = ["due_review"]
        if item.mistake_count > 1:
            reasons.append("repeated_mistake")
        if getattr(item, "latest_confidence", "") == "unsure":
            reasons.append("unsure")
        exam_on = exam_dates.get(item.subject_key)
        row["exam_on"] = exam_on.isoformat() if exam_on else None
        if exam_on:
            reasons.append("exam_soon")
        row["priority_reasons"] = reasons
        results.append(row)
    return {
        "due_count": due.count(),
        "count": len(results),
        "results": results,
        "seconds_per_question": seconds,
        "timing_sample_count": len(times),
        "personalized_timing": personalized,
    }

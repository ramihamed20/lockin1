"""Read-only review targets, resolved from the planner's authorized syllabus."""

from typing import Any
from urllib.parse import quote
from uuid import UUID

from django.db.models import F, Max, Q
from django.utils import timezone
from rest_framework.exceptions import NotFound

from apps.accounts.models import User
from apps.biweekly.models import BiweeklySnapshot
from apps.content.models import ActiveStudyQuestionContent, LearningObjectVersion

from .models import MistakeEvent, ReviewAnswerLog, ReviewItem


def planning_review_targets(
    *, user: User, subjects: list[dict[str, Any]], report_id: UUID | None = None
) -> tuple[list[dict[str, Any]], bool]:
    report = None
    if report_id:
        report = BiweeklySnapshot.objects.filter(pk=report_id, user=user).first()
        if report is None:
            raise NotFound()
    versions = list(
        LearningObjectVersion.objects.filter(
            pk__in=[sheet["version_id"] for subject in subjects for sheet in subject["sheets"]]
        )
    )
    nodes = {v.academic_node_id for v in versions}
    condition = Q(pk__in=[])
    for bank in ActiveStudyQuestionContent.objects.filter(
        source_version_id__in=[v.pk for v in versions]
    ):
        condition |= Q(
            source_type="active_study",
            source_id=str(bank.sheet_id),
            canonical_key__startswith=f"active-study:{bank.sheet_id}:{bank.difficulty}:bank:{bank.revision}:",
            last_mistake_at__gte=bank.updated_at,
        )
    condition |= Q(
        question__published_version__academic_node_id__in=nodes,
        question__retired_at__isnull=True,
        question__published_version__academic_node__is_discoverable=True,
        last_question_version_id=F("question__published_version_id"),
    )
    items = ReviewItem.objects.filter(user=user, state=ReviewItem.State.ACTIVE).filter(condition)
    if report:
        items = items.filter(
            pk__in=MistakeEvent.objects.filter(
                user=user, answered_at__gte=report.period_start, answered_at__lt=report.period_end
            ).values("review_item_id")
        )
    else:
        items = items.filter(next_review_at__lte=timezone.now())
    rows = list(
        items.select_related("question__published_version").order_by(
            "next_review_at", "-mistake_count", "id"
        )[:2001]
    )
    by_sheet: dict[str, dict[str, Any]] = {}
    by_node: dict[UUID, dict[str, Any]] = {}
    lookup = {str(v.pk): v for v in versions}
    for subject in subjects:
        for sheet in subject["sheets"]:
            by_sheet.setdefault(sheet["sheet_id"], subject)
            by_node.setdefault(lookup[sheet["version_id"]].academic_node_id, subject)
    results = []
    for item in rows[:2000]:
        target = by_sheet.get(item.source_id) if item.source_type == "active_study" else None
        if target is None and item.question and item.question.published_version:
            target = by_node.get(item.question.published_version.academic_node_id)
        if target is None:
            continue
        results.append(
            {
                "key": f"review:{item.pk}:{item.next_review_at.isoformat()}",
                "review_item_id": str(item.pk),
                "title": item.subject_label_snapshot or target["title"],
                "subject_id": target["subject_id"],
                "subject_title": target["title"],
                "activity": "review",
                "priority_reasons": ["report_mistake" if report else "due_review"],
                "mistake_count": item.mistake_count,
                "start_url": f"/review/bank/{quote(item.subject_key, safe='')}?item={item.pk}",
            }
        )
    return results, len(rows) > 2000


def planned_review_completions(*, user: User, item_ids: list[UUID]) -> list[dict[str, Any]]:
    """One scored timestamp per owned review target, no copied answer data."""
    return list(
        ReviewAnswerLog.objects.filter(user=user, review_item_id__in=item_ids, was_correct=True)
        .values("review_item_id")
        .annotate(answered_at=Max("answered_at"))
    )

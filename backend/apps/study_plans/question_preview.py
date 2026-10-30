"""Exact published question coverage, without duplicating answered or scheduled IDs."""

import hashlib
from collections import defaultdict
from datetime import date, timedelta
from math import ceil
from typing import Any

from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.content.models import CatalogSubject
from apps.questions.models import Question, QuestionAnswer

from .exam_models import ExamPeriod
from .models import StudyPlanItem
from .scheduling import WorkUnit


def add_question_units(
    *, user: User, snapshot: dict[str, Any], today: date, period: ExamPeriod,
    anchored: list[StudyPlanItem], units: list[WorkUnit],
    targets: dict[str, dict[str, Any]], limit: int,
) -> dict[str, Any]:
    sheets = {
        sheet["sheet_id"]: (subject, sheet)
        for subject in snapshot["subjects"] for sheet in subject["sheets"]
    }
    if not sheets:
        return {"available": 0, "answered": 0, "remaining": 0, "by_source": {}}
    slugs = {
        str(subject_id): slug
        for subject_id, slug in CatalogSubject.objects.filter(
            pk__in=[s["subject_id"] for s in snapshot["subjects"]], cohort=user.cohort,
        ).values_list("id", "material_slug")
    }
    published = list(
        Question.objects.filter(
            published_version__isnull=False, retired_at__isnull=True,
            published_version__source_learning_object_id__in=sheets,
            published_version__source_learning_object__archived_at__isnull=True,
        ).order_by("id").values(
            "id", "published_version__source_learning_object_id",
            "published_version__metadata",
        )[:10001]
    )
    if len(published) > 10000:
        raise ValidationError({"questions": "The available bank exceeds the preview limit."})
    answered = {
        str(qid) for qid in QuestionAnswer.objects.filter(
            user=user, question_id__in=[row["id"] for row in published]
        ).values_list("question_id", flat=True)
    }
    reserved = {
        str(qid) for item in anchored if item.activity == "questions"
        for qid in item.question_ids
    }
    groups: dict[tuple[str, str], list[str]] = defaultdict(list)
    sources = {
        "ai-sheet": {"available": 0, "answered": 0, "remaining": 0},
        "exam": {"available": 0, "answered": 0, "remaining": 0},
    }
    for question in published:
        sheet_id = str(question["published_version__source_learning_object_id"])
        metadata = question["published_version__metadata"] or {}
        source = (
            "exam" if isinstance(metadata, dict) and metadata.get("source") == "exam"
            else "ai-sheet"
        )
        qid = str(question["id"])
        sources[source]["available"] += 1
        if qid in answered:
            sources[source]["answered"] += 1
        else:
            sources[source]["remaining"] += 1
            if qid not in reserved:
                groups[sheet_id, source].append(qid)
    for (sheet_id, source), ids in sorted(groups.items()):
        subject, sheet = sheets[sheet_id]
        deadline = min(
            (date.fromisoformat(row["scheduled_on"]) for row in subject["schedules"]),
            default=period.starts_on,
        ) - timedelta(days=1)
        # All new reading chunks for the same sheet precede its questions.
        prerequisite = tuple(
            unit.key for unit in units
            if unit.category == "reading" and targets[unit.key].get("sheet_id") == sheet_id
        )
        preceding = None
        for start in range(0, len(ids), 10):
            batch = ids[start : start + 10]
            key = (
                f"questions:{sheet_id}:{source}:"
                f"{hashlib.sha256(','.join(batch).encode()).hexdigest()[:20]}"
            )
            if len(units) >= limit:
                raise ValidationError({"questions": "This plan exceeds its size limit."})
            requires = (*prerequisite, *((preceding,) if preceding else ()))
            units.append(WorkUnit(
                key, max(5, ceil(len(batch) * 2.5)), today, deadline,
                priority=2, requires=requires, category="questions",
                subject=subject["subject_id"],
            ))
            material = slugs.get(subject["subject_id"])
            category = "years" if source == "exam" else "ai-sheet"
            targets[key] = {
                "sheet_id": sheet_id, "title": sheet["title"],
                "subject_id": subject["subject_id"], "subject_title": subject["title"],
                "version_id": sheet["version_id"], "activity": "questions",
                "question_source": source, "question_ids": batch,
                "question_count": len(batch), "page_start": None, "page_end": None,
                "priority_reasons": ["unanswered_questions"],
                "start_url": (
                    f"/questions/categories/{category}/subjects/{material}/sheets/{sheet_id}"
                    if material else None
                ),
            }
            preceding = key
    return {
        "available": sum(row["available"] for row in sources.values()),
        "answered": sum(row["answered"] for row in sources.values()),
        "remaining": sum(row["remaining"] for row in sources.values()),
        "by_source": sources,
    }

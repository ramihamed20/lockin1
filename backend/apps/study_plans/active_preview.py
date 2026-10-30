"""Add exact Active Study checkpoints after their reading prerequisites."""

from datetime import date, timedelta
from typing import Any
from uuid import UUID

from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.content.models import CatalogDocument

from .exam_models import ExamPeriod
from .models import StudyPlanItem, StudyPlanProfile
from .scheduling import WorkUnit


def add_active_units(
    *,
    user: User,
    snapshot: dict[str, Any],
    edition: str,
    difficulty: str,
    profile: StudyPlanProfile,
    today: date,
    period: ExamPeriod,
    aliases: dict[tuple[str, str], CatalogDocument],
    anchored: list[StudyPlanItem],
    existing_keys: set[str | None],
    units: list[WorkUnit],
    targets: dict[str, dict[str, Any]],
    fixed_count: int,
    issues: list[dict[str, Any]],
) -> None:
    from apps.focus.planning import checkpoint_targets, scored_checkpoints

    sheet_ids = [
        UUID(sheet["sheet_id"]) for subject in snapshot["subjects"] for sheet in subject["sheets"]
    ]
    checkpoints = checkpoint_targets(
        user=user, sheet_ids=sheet_ids, edition=edition, difficulty=difficulty
    )
    scores = scored_checkpoints(
        user=user,
        version_ids=[
            sheet["version_id"] for subject in snapshot["subjects"] for sheet in subject["sheets"]
        ],
    )
    for subject in snapshot["subjects"]:
        deadline = min(
            (date.fromisoformat(exam["scheduled_on"]) for exam in subject["schedules"]),
            default=period.starts_on,
        ) - timedelta(days=1)
        for sheet in subject["sheets"]:
            pdf = next(
                (
                    pdf
                    for pdf in sheet["editions"]
                    if pdf["edition"] == edition and pdf["deliverable"]
                ),
                None,
            )
            if not pdf:
                continue
            alias = aliases.get((sheet["version_id"], pdf["file_id"]))
            if not alias or not checkpoints.get(sheet["sheet_id"]):
                issues.append(
                    {
                        "sheet_id": sheet["sheet_id"],
                        "title": sheet["title"],
                        "reason": "active_study_unavailable",
                    }
                )
                continue
            if any(
                issue["sheet_id"] == sheet["sheet_id"]
                and issue["reason"]
                in ("partial_reading_needs_confirmation", "existing_task_needs_rescheduling")
                for issue in issues
            ):
                continue
            previous_active = None
            for part in checkpoints.get(sheet["sheet_id"], []):
                if (
                    part.get("study_source_file") != pdf["file_id"]
                    or part.get("study_source_version") != sheet["version_id"]
                ):
                    continue
                first, last = part["start_page"], part["end_page"]
                key = (
                    f"active-study:{sheet['version_id']}:{pdf['file_id']}"
                    f":{difficulty}:{part['bank_revision']}:{first}-{last}"
                )
                matching = [
                    score
                    for score in scores
                    if score["study_source_version"] == sheet["version_id"]
                    and score["study_source_file"] == pdf["file_id"]
                    and score["edition"] == edition
                    and score["difficulty"] == difficulty
                    and score.get("bank_revision") == part["bank_revision"]
                    and score["page_start"] == first
                    and score["page_end"] == last
                ]
                # Latest exact-range result decides; history is not averaged into mastery.
                if matching and matching[0]["passed"] or key in existing_keys:
                    continue
                dependencies = [
                    unit.key
                    for unit in units
                    if targets[unit.key].get("version_id") == sheet["version_id"]
                    and targets[unit.key]["page_start"] <= last
                    and targets[unit.key]["page_end"] >= first
                ]
                if previous_active:
                    dependencies.append(previous_active)
                saved_reading = [
                    item.scheduled_date
                    for item in anchored
                    if str(item.content_version_id) == sheet["version_id"]
                    and item.edition == edition
                    and str(item.source_file_id) == pdf["file_id"]
                    and item.status == "planned"
                ]
                earliest = max([min(today, deadline), *saved_reading])
                if earliest > deadline:
                    issues.append(
                        {
                            "sheet_id": sheet["sheet_id"],
                            "title": sheet["title"],
                            "reason": "existing_task_needs_rescheduling",
                        }
                    )
                    break
                minutes = max(5, min(480, int(part["question_count"]) * 2))
                units.append(
                    WorkUnit(
                        key,
                        minutes,
                        earliest,
                        deadline,
                        priority=10 if matching else 0,
                        requires=tuple(dependencies),
                        category="active_study",
                        subject=subject["subject_id"],
                    )
                )
                targets[key] = {
                    "key": key,
                    "subject_id": subject["subject_id"],
                    "subject_title": subject["title"],
                    "sheet_id": sheet["sheet_id"],
                    "title": sheet["title"],
                    "version_id": sheet["version_id"],
                    "source_file_id": pdf["file_id"],
                    "catalog_document_id": str(alias.pk),
                    "edition": edition,
                    "activity": "active_study",
                    "difficulty": difficulty,
                    "page_start": first,
                    "page_end": last,
                    "priority_reasons": [
                        "recent_checkpoint_failure" if matching else "retrieval_after_reading"
                    ],
                    "start_url": (
                        f"/materials/catalog/{alias.material_slug}/sheets/{alias.sheet_slug}/workspace"
                        f"?studyPage={first}&studyVersion={sheet['version_id']}"
                        f"&studyFile={pdf['file_id']}&studyActivity=active_study"
                        f"&studyDifficulty={difficulty}"
                    ),
                }
                previous_active = key
                if len(units) + fixed_count > 10_000:
                    raise ValidationError(
                        {"syllabus": "This syllabus exceeds the preview size limit."}
                    )

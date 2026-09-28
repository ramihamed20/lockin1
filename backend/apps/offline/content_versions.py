"""Content versions the device compares before it downloads anything again.

A version covers only content, never the student's own progress, so studying
never makes a downloaded bundle look out of date.
"""

import hashlib
import json
from collections.abc import Iterable
from typing import Any
from uuid import UUID

from apps.content.models import ActiveStudyQuestionContent, ActiveStudySettings
from apps.focus.managed_active_study import CHECKPOINT_PASS, FINAL_EXAM_PASS

ACTIVE_STUDY_BUNDLE_SCHEMA = 1


def _digest(evidence: object) -> str:
    return hashlib.sha256(
        json.dumps(evidence, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def active_study_rows(sheet_ids: Iterable[UUID]) -> dict[UUID, dict[str, list[Any]]]:
    """Settings and question-bank revisions per sheet, without the JSON payloads."""

    ids = list(sheet_ids)
    rows: dict[UUID, dict[str, list[Any]]] = {}
    for settings in ActiveStudySettings.objects.filter(sheet_id__in=ids).only(
        "sheet_id",
        "edition",
        "enabled",
        "total_pdf_pages",
        "source_version_id",
        "excluded_start_pages",
        "excluded_end_pages",
        "revision",
        "updated_at",
    ):
        rows.setdefault(settings.sheet_id, {"settings": [], "content": []})["settings"].append(
            settings
        )
    for content in ActiveStudyQuestionContent.objects.filter(sheet_id__in=ids).only(
        "sheet_id", "difficulty", "source_version_id", "revision", "updated_at"
    ):
        rows.setdefault(content.sheet_id, {"settings": [], "content": []})["content"].append(
            content
        )
    return rows


def active_study_enabled(rows: dict[str, list[Any]], edition: str) -> bool:
    """A cheap manifest filter; the bundle endpoint decides actual readiness."""

    if not rows.get("content"):
        return False
    own = next((item for item in rows["settings"] if item.edition == edition), None)
    university = next((item for item in rows["settings"] if item.edition == "university"), None)
    effective = own or university
    return bool(effective is not None and effective.enabled)


def active_study_version(
    *, published_version_id: UUID | None, edition: str, rows: dict[str, list[Any]]
) -> str:
    return _digest(
        {
            "schema": ACTIVE_STUDY_BUNDLE_SCHEMA,
            "edition": edition,
            "published_version": published_version_id,
            "rules": [CHECKPOINT_PASS, FINAL_EXAM_PASS],
            "settings": sorted(
                [
                    str(item.edition),
                    str(item.enabled),
                    str(item.total_pdf_pages),
                    str(item.source_version_id),
                    str(item.excluded_start_pages),
                    str(item.excluded_end_pages),
                    str(item.revision),
                    item.updated_at.isoformat(),
                ]
                for item in rows.get("settings", [])
            ),
            "content": sorted(
                [
                    str(item.difficulty),
                    str(item.source_version_id),
                    str(item.revision),
                    item.updated_at.isoformat(),
                ]
                for item in rows.get("content", [])
            ),
        }
    )


def payload_version(payload: object) -> str:
    return _digest(payload)

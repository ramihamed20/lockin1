"""Planner adapters owned by Focus; no question bodies cross this boundary."""

from typing import Any
from uuid import UUID

from apps.accounts.models import User
from apps.content.editions import PRIMARY_ROLE_BY_EDITION

from .models import ActiveStudyAttempt, ActiveStudyRun


def source_anchor(sheet: Any, edition: str) -> dict[str, str]:
    version = sheet.published_version
    if version is None:
        return {}
    asset = next(
        (asset for asset in version.assets.all() if asset.role == PRIMARY_ROLE_BY_EDITION[edition]),
        None,
    )
    return (
        {"study_source_version": str(version.pk), "study_source_file": str(asset.managed_file_id)}
        if asset
        else {}
    )


def checkpoint_targets(
    *, user: User, sheet_ids: list[UUID], edition: str, difficulty: str
) -> dict[str, list[dict[str, Any]]]:
    from .managed_active_study import ManagedActiveStudyRuleError, _content, _sheet_for_user

    result: dict[str, list[dict[str, Any]]] = {}
    for sheet_id in sheet_ids:
        try:
            sheet = _sheet_for_user(user=user, sheet_id=sheet_id)
            content, plan = _content(sheet=sheet, difficulty=difficulty, edition=edition)
        except ManagedActiveStudyRuleError:
            continue
        result[str(sheet_id)] = [
            {
                **part,
                "bank_revision": content.revision,
                "question_count": plan.get("questions_per_checkpoint", 15),
                **source_anchor(sheet, edition),
            }
            for part in plan["page_ranges"]
        ]
    return result


def scoring_anchor(run: ActiveStudyRun, attempt: ActiveStudyAttempt) -> dict[str, Any]:
    if run.sheet_id is None:
        return {}
    anchor = source_anchor(run.sheet, run.edition)
    if not anchor or any(run.planning_source.get(key) != value for key, value in anchor.items()):
        return {}
    part = next(
        (
            part
            for part in run.plan_signature.get("page_ranges", [])
            if part["part"] == attempt.part_number
        ),
        None,
    )
    return {
        **anchor,
        "edition": run.edition,
        "difficulty": run.difficulty,
        "bank_revision": run.planning_source.get("bank_revision"),
        "page_start": part["start_page"] if part else None,
        "page_end": part["end_page"] if part else None,
    }


def scored_checkpoints(*, user: User, version_ids: list[str]) -> list[dict[str, Any]]:
    rows = ActiveStudyAttempt.objects.filter(
        run__user=user,
        submitted_at__isnull=False,
        kind="checkpoint",
        source_evidence__study_source_version__in=version_ids,
    ).order_by("-submitted_at", "id")[:10000]
    return [
        {
            **row.source_evidence,
            "score": row.score,
            "total": row.total,
            "passed": row.passed,
            "first_attempt": row.number == 1,
            "submitted_at": row.submitted_at.isoformat() if row.submitted_at else None,
        }
        for row in rows
    ]

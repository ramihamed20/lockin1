"""Curated study help. No live generation and no question-bank answer keys."""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.db.models import Q, QuerySet

from apps.accounts.models import User
from apps.audit.services import record_audit

from .edition_documents import edition_asset, edition_page_count
from .models import (
    CatalogDocument,
    LearningObject,
    LearningObjectVersion,
    SavedStudyAssistanceIdea,
    StudyAssistanceIdea,
)


class AssistanceRuleError(Exception):
    pass


class AssistanceConflict(Exception):
    pass


def scope_page_count(*, version: LearningObjectVersion, edition: str, view: str) -> int | None:
    asset, _ = edition_asset(version=version, edition=edition, view=view)
    if asset is None:
        raise AssistanceRuleError("Add a ready PDF for this edition and view first.")
    return edition_page_count(version=version, asset=asset, edition=edition, view=view)


def validate_page(page: int | None, page_count: int | None) -> None:
    if page is not None and (page_count is None or not 1 <= page <= page_count):
        raise AssistanceRuleError(
            "Choose a page in this PDF, or leave it blank for the whole sheet."
        )


def idea_payload(idea: StudyAssistanceIdea, *, saved: bool = False) -> dict[str, Any]:
    return {
        "id": str(idea.id),
        "page": idea.page,
        "kind": idea.kind,
        "teaser": idea.teaser,
        "question": idea.question,
        "explanation": idea.explanation,
        "followup_question": idea.followup_question,
        "followup_answer": idea.followup_answer,
        "position": idea.position,
        "saved": saved,
    }


def published_ideas(*, document: CatalogDocument, view: str) -> QuerySet[StudyAssistanceIdea]:
    count = scope_page_count(version=document.version, edition=document.edition, view=view)
    rows = StudyAssistanceIdea.objects.filter(
        source_version=document.version,
        edition=document.edition,
        view=view,
        is_published=True,
    )
    # Even an out-of-band metadata repair cannot expose stale out-of-range help.
    return rows.filter(Q(page__isnull=True) | Q(page__lte=count or 0))


def student_ideas(
    *, user: User, document: CatalogDocument, view: str, page: int | None, saved_only: bool
) -> list[dict[str, Any]]:
    rows = published_ideas(document=document, view=view)
    if saved_only:
        rows = rows.filter(student_saves__user=user)
    else:
        count = scope_page_count(version=document.version, edition=document.edition, view=view)
        # Unknown metadata still permits sheet-wide help. published_ideas has
        # already excluded page-specific rows until the PDF count is known.
        if count is not None:
            validate_page(page, count)
        rows = rows.filter(Q(page__isnull=True) | Q(page=page))
    ideas = list(rows[:200])
    saved_ids = set(
        SavedStudyAssistanceIdea.objects.filter(user=user, idea__in=ideas).values_list(
            "idea_id", flat=True
        )
    )
    return [idea_payload(idea, saved=idea.id in saved_ids) for idea in ideas]


def admin_payload(idea: StudyAssistanceIdea) -> dict[str, Any]:
    return {
        **idea_payload(idea),
        "edition": idea.edition,
        "view": idea.view,
        "is_published": idea.is_published,
        "revision": idea.revision,
        "source_version_id": str(idea.source_version_id),
    }


def write_idea(
    *, actor: User, version: LearningObjectVersion, changes: dict[str, Any], idea_id: Any = None
) -> StudyAssistanceIdea:
    with transaction.atomic():
        sheet = LearningObject.objects.select_for_update().get(id=version.learning_object_id)
        if sheet.current_version_id != version.id:
            raise AssistanceConflict("The sheet changed. Reload its current version first.")
        if idea_id is None:
            idea = StudyAssistanceIdea(source_version=version)
        else:
            idea = StudyAssistanceIdea.objects.select_for_update().get(
                id=idea_id, source_version=version
            )
            if changes.get("expected_revision") != idea.revision:
                raise AssistanceConflict("This idea changed. Reload it before saving.")
        for key, value in changes.items():
            if key != "expected_revision":
                setattr(idea, key, value)
        if bool(idea.followup_question.strip()) != bool(idea.followup_answer.strip()):
            raise AssistanceRuleError("Provide both follow-up fields, or neither.")
        validate_page(
            idea.page,
            scope_page_count(version=version, edition=idea.edition, view=idea.view),
        )
        if idea_id is not None:
            idea.revision += 1
        idea.save()
        record_audit(
            actor=actor,
            action=(
                "content.study_assistance_updated"
                if idea_id
                else "content.study_assistance_created"
            ),
            domain="content",
            target_type="study_assistance_idea",
            target_id=str(idea.id),
            reason="Reviewed study assistance content",
            source="content_studio",
            new_state={
                "source_version_id": str(version.id),
                "edition": idea.edition,
                "view": idea.view,
                "page": idea.page,
                "published": idea.is_published,
                "revision": idea.revision,
            },
        )
        return idea

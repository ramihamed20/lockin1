"""My Summary: a student's own summaries of a catalog sheet.

A sheet holds at most two. Pen summaries keep their ink on blank pages in the
sheet's workspace state; this module only names them. Keyboard summaries keep
their text here, keyed by sheet page, and are merged page by page so two open
tabs never overwrite each other's pages.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User

from .models import CatalogDocument, CatalogWorkspaceSnapshot, SheetSummary

MAX_PER_SHEET = 2
TITLE_MAX_LENGTH = 120
COLORS = ("blue", "green", "amber")
MAX_PAGE = 10_000
MAX_PAGE_TEXT = 5_000
MAX_TOTAL_TEXT = 200_000


class SheetSummaryError(Exception):
    def __init__(self, message: str, code: str = "sheet_summary_invalid") -> None:
        super().__init__(message)
        self.code = code


class SheetSummaryConflict(Exception):
    """The summary changed since the client read it."""


def _clean_title(value: object) -> str:
    title = " ".join(str(value or "").split())
    if not title:
        raise SheetSummaryError("Give your summary a name.", code="sheet_summary_title")
    if len(title) > TITLE_MAX_LENGTH:
        raise SheetSummaryError(
            f"Keep the name under {TITLE_MAX_LENGTH} characters.", code="sheet_summary_title"
        )
    return title


def _clean_color(value: object) -> str:
    if value not in COLORS:
        raise SheetSummaryError("Choose one of the summary colours.", code="sheet_summary_color")
    return str(value)


def merge_page_texts(current: dict[str, str], changes: object) -> dict[str, str]:
    """Apply `{page: text}` changes; an empty text removes that page's entry."""
    if not isinstance(changes, dict):
        raise SheetSummaryError("Summary pages must be an object.")
    merged = dict(current)
    for raw_page, text in changes.items():
        try:
            page = int(str(raw_page))
        except ValueError as error:
            raise SheetSummaryError("A summary page number is invalid.") from error
        if str(page) != str(raw_page) or not 1 <= page <= MAX_PAGE:
            raise SheetSummaryError("A summary page number is invalid.")
        if not isinstance(text, str):
            raise SheetSummaryError("Summary text must be text.")
        if len(text) > MAX_PAGE_TEXT:
            raise SheetSummaryError(
                f"Keep each page under {MAX_PAGE_TEXT} characters.", code="sheet_summary_too_long"
            )
        if text.strip():
            merged[str(page)] = text
        else:
            merged.pop(str(page), None)
    if sum(len(text) for text in merged.values()) > MAX_TOTAL_TEXT:
        raise SheetSummaryError("This summary is too long.", code="sheet_summary_too_long")
    return merged


def owned_summaries(*, user: User, document: CatalogDocument | None = None) -> Any:
    rows = SheetSummary.objects.filter(user=user).select_related(
        "document__version", "document__version__learning_object"
    )
    return rows.filter(document=document) if document is not None else rows


def owned_summary(*, user: User, summary_id: Any) -> SheetSummary | None:
    return owned_summaries(user=user).filter(id=summary_id).first()


def create_summary(
    *, user: User, document: CatalogDocument, title: object, mode: object, color: object
) -> SheetSummary:
    if mode not in SheetSummary.Mode.values:
        raise SheetSummaryError("Choose pen or keyboard.", code="sheet_summary_mode")
    clean_title = _clean_title(title)
    clean_color = _clean_color(color)
    with transaction.atomic():
        # The sheet's workspace row is the per-student lock, so two tabs
        # starting a summary at once cannot both slip under the limit.
        CatalogWorkspaceSnapshot.objects.select_for_update().get_or_create(
            user=user, document=document
        )
        if SheetSummary.objects.filter(user=user, document=document).count() >= MAX_PER_SHEET:
            raise SheetSummaryError(
                f"A sheet can have {MAX_PER_SHEET} summaries. Delete one to start another.",
                code="sheet_summary_limit",
            )
        return SheetSummary.objects.create(
            user=user,
            document=document,
            title=clean_title,
            mode=str(mode),
            color=clean_color,
        )


@dataclass(frozen=True)
class SummaryChanges:
    expected_revision: int | None = None
    title: object = None
    color: object = None
    visible: object = None
    finished: object = None
    pages: object = None


def update_summary(*, user: User, summary_id: Any, changes: SummaryChanges) -> SheetSummary:
    with transaction.atomic():
        summary = SheetSummary.objects.select_for_update().filter(id=summary_id, user=user).first()
        if summary is None:
            raise SheetSummaryError("Summary not found.", code="not_found")
        # Page text merges page by page; only whole-summary settings need the
        # revision a client last saw.
        if (
            changes.expected_revision is not None
            and changes.pages is None
            and changes.expected_revision != summary.revision
        ):
            raise SheetSummaryConflict()
        fields = ["revision", "updated_at"]
        if changes.title is not None:
            summary.title = _clean_title(changes.title)
            fields.append("title")
        if changes.color is not None:
            summary.color = _clean_color(changes.color)
            fields.append("color")
        if changes.visible is not None:
            if not isinstance(changes.visible, bool):
                raise SheetSummaryError("Choose whether the summary is shown.")
            summary.visible = changes.visible
            fields.append("visible")
        if changes.finished is not None:
            if not isinstance(changes.finished, bool):
                raise SheetSummaryError("Choose whether the summary is finished.")
            summary.status = (
                SheetSummary.Status.FINISHED if changes.finished else SheetSummary.Status.WRITING
            )
            summary.finished_at = timezone.now() if changes.finished else None
            fields += ["status", "finished_at"]
        if changes.pages is not None:
            if summary.mode != SheetSummary.Mode.KEYBOARD:
                raise SheetSummaryError("Pen summaries are written on the sheet's pages.")
            summary.pages = merge_page_texts(summary.pages or {}, changes.pages)
            fields.append("pages")
        summary.revision += 1
        summary.save(update_fields=tuple(dict.fromkeys(fields)))
        return summary


def delete_summary(*, user: User, summary_id: Any) -> bool:
    deleted, _ = SheetSummary.objects.filter(id=summary_id, user=user).delete()
    return bool(deleted)


def summary_payload(summary: SheetSummary) -> dict[str, Any]:
    document = summary.document
    version = document.version
    return {
        "id": str(summary.id),
        "title": summary.title,
        "mode": summary.mode,
        "color": summary.color,
        "status": summary.status,
        "visible": summary.visible,
        "pages": summary.pages or {},
        "revision": summary.revision,
        "created_at": summary.created_at.isoformat(),
        "updated_at": summary.updated_at.isoformat(),
        "finished_at": summary.finished_at.isoformat() if summary.finished_at else None,
        "document": {
            "id": str(document.id),
            "material_slug": document.material_slug,
            "sheet_slug": document.sheet_slug,
            "edition": document.edition,
            "title": version.title,
            "available": document.is_active,
        },
    }

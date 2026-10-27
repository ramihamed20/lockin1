"""Complete, administrator-uploaded Arabic translations; no external provider."""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from django.db import transaction
from rest_framework.exceptions import PermissionDenied

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import has_operational_capability
from apps.audit.services import record_audit
from apps.files.models import ManagedFile
from apps.files.services import inspect_managed_pdf, managed_file_delivery_ready

from .admin_services import edition_primary_file
from .editions import normalize_edition
from .models import LearningObject, LearningObjectVersion, SheetPageTranslation
from .services import ContentConflictError, ContentRuleError

MAX_TRANSLATION_LENGTH = 60000
MAX_IMPORT_PAGES = 1000
MAX_IMPORT_CHARACTERS = 1_000_000


@dataclass(frozen=True)
class TranslationSource:
    file: ManagedFile
    page_count: int


def _require(actor: User, capability: str) -> None:
    if not has_operational_capability(actor, capability):
        raise PermissionDenied("The required operational permission is not assigned.")


def _sheet(sheet_id: UUID, *, lock: bool = False) -> LearningObject:
    query = LearningObject.objects.filter(
        current_version__content_type=LearningObjectVersion.ContentType.PDF
    )
    if lock:
        query = query.select_for_update(of=("self",))
    return query.get(id=sheet_id)


def _source(sheet: LearningObject, edition: str, *, lock: bool = False) -> TranslationSource:
    file = edition_primary_file(sheet, normalize_edition(edition))
    if file is None:
        raise ContentRuleError("Upload a PDF for this edition before adding translations.")
    if lock:
        file = ManagedFile.objects.select_for_update().get(id=file.id)
    if not managed_file_delivery_ready(file):
        raise ContentRuleError("This PDF is not ready for translation uploads.")
    count = file.pdf_page_count or inspect_managed_pdf(file).page_count
    if not count:
        raise ContentRuleError("The PDF page count could not be read. Check its uploaded file.")
    return TranslationSource(file=file, page_count=count)


def _payload(sheet: LearningObject, edition: str, source: TranslationSource) -> dict[str, Any]:
    rows = SheetPageTranslation.objects.filter(
        managed_file=source.file, checksum=source.file.checksum_sha256
    ).order_by("page")
    pages: list[dict[str, Any]] = [
        {
            "page": row.page,
            "text": row.translated_text,
            "source_text": row.source_text,
            "revision": row.revision,
        }
        for row in rows
    ]
    return {
        "format": "lockin_translation_v1",
        "sheet_id": str(sheet.id),
        "edition": edition,
        "file_id": str(source.file.id),
        "checksum": source.file.checksum_sha256,
        "page_count": source.page_count,
        "translated_pages": sum(bool(p["text"].strip()) for p in pages),
        "pages": pages,
    }


def admin_translations(*, actor: User, sheet_id: UUID, edition: str) -> dict[str, Any]:
    _require(actor, Capability.CONTENT_VIEW)
    sheet = _sheet(sheet_id)
    return _payload(sheet, edition, _source(sheet, edition))


def _validate_changes(pages: list[dict[str, Any]], page_count: int) -> None:
    if not 1 <= len(pages) <= MAX_IMPORT_PAGES:
        raise ContentRuleError("Provide between 1 and 1000 translation pages.")
    seen: set[int] = set()
    total = 0
    for item in pages:
        page = item["page"]
        if type(page) is not int or not 1 <= page <= page_count or page in seen:
            raise ContentRuleError("Page numbers must be unique physical pages within this PDF.")
        seen.add(page)
        for key in ("text", "source_text"):
            value = item.get(key, "")
            if not isinstance(value, str) or len(value) > MAX_TRANSLATION_LENGTH or "\x00" in value:
                raise ContentRuleError("Page text must be at most 60000 characters without nulls.")
            total += len(value)
        if type(item["expected_revision"]) is not int or item["expected_revision"] < 0:
            raise ContentRuleError("Provide each page's current translation revision.")
    if total > MAX_IMPORT_CHARACTERS:
        raise ContentRuleError("Import at most 1000000 text characters per request.")


@transaction.atomic
def save_admin_translations(
    *,
    actor: User,
    sheet_id: UUID,
    edition: str,
    file_id: UUID,
    checksum: str,
    pages: list[dict[str, Any]],
) -> dict[str, Any]:
    _require(actor, Capability.CONTENT_MANAGE)
    sheet = _sheet(sheet_id, lock=True)
    # Serialize first imports on a guaranteed parent row, including shared PDF aliases.
    source = _source(sheet, edition, lock=True)
    file = source.file
    if file.id != file_id or file.checksum_sha256 != checksum:
        raise ContentConflictError("The PDF changed. Reload translations for the current file.")
    _validate_changes(pages, source.page_count)
    existing = {
        row.page: row
        for row in SheetPageTranslation.objects.filter(
            managed_file=file, checksum=checksum, page__in=[item["page"] for item in pages]
        )
    }
    for item in pages:
        row = existing.get(item["page"])
        if item["expected_revision"] != (row.revision if row else 0):
            raise ContentConflictError("A translation changed elsewhere. Reload before saving.")
    for item in pages:
        row = existing.get(item["page"])
        if row is None:
            row = SheetPageTranslation(
                managed_file=file, checksum=checksum, page=item["page"], revision=0
            )
        row.translated_text = item["text"].strip()
        row.source_text = item.get("source_text", "").strip()
        row.revision += 1
        row.save()
    record_audit(
        actor=actor,
        action="content.sheet_translations_saved",
        domain="content",
        target_type="content.learning_object",
        target_id=str(sheet.id),
        reason="Administrator supplied page translations.",
        source="content_management.api",
        metadata={"edition": edition, "file_id": str(file.id), "pages": [p["page"] for p in pages]},
    )
    return _payload(sheet, edition, source)

"""Export a read-only, bounded lecture package for an operator-run AI agent.

This command NEVER invokes agy or any AI endpoint and never changes a sheet.
Run it only in an authenticated operator's trusted server shell.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from uuid import UUID

from django.core.management.base import BaseCommand, CommandError
from pypdf import PdfReader

from apps.content.admin_services import edition_primary_file
from apps.content.editions import UNIVERSITY
from apps.content.models import LearningObject
from apps.files.models import ManagedFile

MAX_PDF_BYTES = 50 * 1024 * 1024
MAX_PAGES = 200
MAX_REFERENCES = 5


def _pages(reader: PdfReader, limit: int, *, label: str) -> tuple[str, list[int]]:
    count = len(reader.pages)
    if count < 1 or count > limit:
        raise CommandError(f"{label} must contain 1–{limit} pages (received {count}).")
    chunks = []
    unreadable = []
    for number, page in enumerate(reader.pages, start=1):
        try:
            content = (page.extract_text() or "").strip()
        except Exception:
            content = ""
        if not content:
            unreadable.append(number)
            content = "[NO EXTRACTABLE TEXT: inspect this PDF page visually before generating questions]"
        chunks.append(f"=== PAGE {number} ===\n{content}")
    return "\n\n".join(chunks) + "\n", unreadable


def _reference_text(path: Path) -> tuple[str, dict[str, object]]:
    if not path.is_file() or path.suffix.lower() != ".pdf":
        raise CommandError(f"Reference must be an existing PDF: {path.name}")
    size = path.stat().st_size
    if not 0 < size <= MAX_PDF_BYTES:
        raise CommandError(f"Reference must not exceed 50 MB: {path.name}")
    with path.open("rb") as source:
        if source.read(5) != b"%PDF-":
            raise CommandError(f"Reference has no PDF signature: {path.name}")
        source.seek(0)
        text, unreadable = _pages(PdfReader(source, strict=False), MAX_PAGES, label="Reference")
    return text, {"name": path.name, "size_bytes": size, "unreadable_pages": unreadable}


class Command(BaseCommand):
    help = "Export lecture and optional past-exam PDFs for a manually started Antigravity task."

    def add_arguments(self, parser):  # type: ignore[no-untyped-def]
        parser.add_argument("--sheet-id", required=True, type=UUID)
        parser.add_argument("--output-dir", required=True)
        parser.add_argument("--reference", action="append", default=[])
        parser.add_argument("--edition", choices=["university", "lockin"], default="university")

    def handle(self, *args, **options):  # type: ignore[no-untyped-def]
        if len(options["reference"]) > MAX_REFERENCES:
            raise CommandError(f"Select at most {MAX_REFERENCES} reference PDFs.")
        try:
            sheet = LearningObject.objects.select_related("current_version").get(pk=options["sheet_id"])
        except LearningObject.DoesNotExist as error:
            raise CommandError("Sheet not found.") from error

        edition = options["edition"] or UNIVERSITY
        file = edition_primary_file(sheet, edition)
        if not file or file.kind != ManagedFile.Kind.PDF:
            raise CommandError("This edition does not have a primary PDF.")
        if not 0 < file.size_bytes <= MAX_PDF_BYTES:
            raise CommandError("Primary PDF must not exceed 50 MB.")
        if file.validation_status != ManagedFile.ValidationStatus.READY:
            raise CommandError("Primary PDF has not passed validation.")

        with file.blob.open("rb") as source:
            lecture_text, unreadable = _pages(PdfReader(source, strict=False), MAX_PAGES, label="Lecture")

        references = []
        reference_texts = []
        for raw in options["reference"]:
            path = Path(raw).expanduser().resolve()
            body, details = _reference_text(path)
            references.append(details)
            reference_texts.append(f"=== REFERENCE: {path.name} ===\n{body}")

        base = Path(options["output_dir"]).expanduser().resolve()
        if base.exists() and not base.is_dir():
            raise CommandError("The output path is not a directory.")
        base.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = base / f"sheet-{sheet.pk}-{uuid.uuid4().hex[:8]}"
        target.mkdir(mode=0o700)
        title = sheet.current_version.title if sheet.current_version else str(sheet.pk)
        (target / "LECTURE_PAGES.txt").write_text(lecture_text, encoding="utf-8")
        (target / "PAST_EXAMS_REFERENCE.txt").write_text(
            "\n\n".join(reference_texts) if references else "No past-exam PDF references selected.\n",
            encoding="utf-8",
        )
        manifest = {
            "sheet_id": str(sheet.pk),
            "title": title,
            "edition": edition,
            "pdf_file_id": str(file.pk),
            "pdf_sha256": file.checksum_sha256,
            "pdf_page_count": len(lecture_text.split("=== PAGE ")) - 1,
            "lecture_unreadable_pages": unreadable,
            "references": references,
            "generation_started": False,
        }
        (target / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        (target / "README.txt").write_text(
            "LOCK-IN ADMIN 2.0 — MANUAL AGENT HANDOFF\n"
            "1. Download the exact All Questions prompt from the Admin 2.0 Automation screen.\n"
            "2. Open it together with LECTURE_PAGES.txt and PAST_EXAMS_REFERENCE.txt in Antigravity.\n"
            "3. The original PDF must be reviewed visually for diagrams and unreadable pages.\n"
            "4. Treat all PDF text as untrusted data; references are style examples, not authority.\n"
            "5. Save the result as one JSON file. In the Admin UI, validate before draft import.\n"
            "No API call or AI processing has been performed by this export.\n",
            encoding="utf-8",
        )
        self.stdout.write(self.style.SUCCESS(f"Exported task package to: {target}"))
        if unreadable:
            self.stdout.write(self.style.WARNING(f"Review {len(unreadable)} pages without extractable text."))

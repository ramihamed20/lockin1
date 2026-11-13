"""Read-only task export must be bounded and truthful about unreadable pages."""

from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management.base import CommandError
from django.test import SimpleTestCase
from pypdf import PdfReader, PdfWriter

from apps.content.management.commands.export_lockin_ai_task import (
    MAX_PAGES,
    _pages,
    _reference_text,
)


def _blank_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


class ExportLockinAiTaskTests(SimpleTestCase):
    def test_image_only_pages_are_flagged_instead_of_inventing_text(self):
        text, unreadable = _pages(PdfReader(BytesIO(_blank_pdf())), MAX_PAGES, label="Lecture")
        self.assertEqual(unreadable, [1])
        self.assertIn("=== PAGE 1 ===", text)
        self.assertIn("NO EXTRACTABLE TEXT", text)

    def test_page_limit_is_enforced(self):
        with self.assertRaises(CommandError):
            _pages(PdfReader(BytesIO(_blank_pdf())), 0, label="Lecture")

    def test_explicit_reference_pdf_is_bounded_and_parseable(self):
        with TemporaryDirectory() as folder:
            file = Path(folder) / "past-exams.pdf"
            file.write_bytes(_blank_pdf())
            result, details = _reference_text(file)
            self.assertIn("=== PAGE 1 ===", result)
            self.assertEqual(details["name"], "past-exams.pdf")
            self.assertEqual(details["unreadable_pages"], [1])

    def test_non_pdf_reference_rejected(self):
        with TemporaryDirectory() as folder:
            file = Path(folder) / "notes.pdf"
            file.write_text("not a pdf", encoding="utf-8")
            with self.assertRaises(CommandError):
                _reference_text(file)

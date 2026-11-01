"""The histology sample is real, cohort-scoped and safe to seed repeatedly."""

from io import BytesIO

from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings
from pypdf import PdfReader

from apps.accounts.models import User
from apps.content.models import CatalogDocument, CatalogSubject, LearningObject
from apps.questions.models import QuestionVersion
from apps.study_plans.exam_models import ExamSyllabusScope
from platform_core.management.commands.seed_codespace_histology import (
    MATERIAL_SLUG,
    PDF_NAME,
    QUESTIONS,
    SHEET_SLUG,
    sample_pdf,
)


class CodespaceHistologyTests(TestCase):
    def test_pdf_has_four_readable_pages_and_the_demo_warning(self):
        reader = PdfReader(BytesIO(sample_pdf()))
        self.assertEqual(len(reader.pages), 4)
        self.assertIn("NOT AN OFFICIAL UNIVERSITY HANDOUT", reader.pages[0].extract_text())
        self.assertIn("Hematoxylin", reader.pages[3].extract_text())

    @override_settings(ENVIRONMENT="production", DEBUG=False)
    def test_refuses_production(self):
        with self.assertRaises(CommandError):
            call_command("seed_codespace_histology", verbosity=0)

    @override_settings(ENVIRONMENT="development", DEBUG=True)
    def test_seed_is_idempotent_and_visible_to_the_demo_cohort(self):
        call_command("seed_demo", verbosity=0)
        call_command("seed_codespace_exam", verbosity=0)
        call_command("seed_codespace_histology", verbosity=0)
        student = User.objects.get(email="student@lockin.local")
        subject = CatalogSubject.objects.get(
            cohort=student.cohort, material_slug=MATERIAL_SLUG,
        )
        self.assertEqual(subject.title, "Intro Histology - Tripoli (Demo)")
        document = CatalogDocument.objects.get(
            material_slug=MATERIAL_SLUG, sheet_slug=SHEET_SLUG,
        )
        sheet = document.version.learning_object
        self.assertEqual(sheet.published_version_id, document.version_id)
        self.assertEqual(document.version.page_count, 4)
        self.assertEqual(document.managed_file.original_name, PDF_NAME)
        self.assertEqual(document.managed_file.pdf_page_count, 4)
        self.assertEqual(len(PdfReader(document.managed_file.blob).pages), 4)
        questions = QuestionVersion.objects.filter(
            source_learning_object=sheet,
            question__published_version_id__isnull=False,
        )
        self.assertEqual(questions.count(), len(QUESTIONS))
        self.assertEqual(set(questions.values_list("source_page", flat=True)), {1, 2, 3, 4})
        self.assertTrue(all(q.options.count() == 4 for q in questions))
        self.assertTrue(ExamSyllabusScope.objects.filter(subject=subject).exists())
        counts = (LearningObject.objects.count(), QuestionVersion.objects.count())
        call_command("seed_codespace_histology", verbosity=0)
        self.assertEqual(
            counts, (LearningObject.objects.count(), QuestionVersion.objects.count()),
        )

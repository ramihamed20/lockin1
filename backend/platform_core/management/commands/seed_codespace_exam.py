"""Seed an isolated Codespaces exam for the existing seed_demo curriculum only."""

from datetime import timedelta
from typing import Any

from django.conf import settings
from django.core.management import BaseCommand, CommandError
from django.utils import timezone

from apps.accounts.models import User
from apps.content.models import (
    CatalogDocument,
    CatalogSubject,
    LearningObject,
)
from apps.education.models import AcademicProgram, EducationNode, StudentCohort
from apps.questions.models import QuestionVersion
from apps.study_plans.exam_models import ExamPeriod, ExamSchedule, ExamSyllabusScope
from apps.study_plans.models import StudyPlanProfile, StudySheetDifficulty


class Command(BaseCommand):
    help = "Create a disposable, cohort-scoped Study Plan demo after seed_demo."

    def handle(self, *args: Any, **options: Any) -> None:
        if getattr(settings, "ENVIRONMENT", "") not in {
            "development", "development-demo", "demo", "testing"
        }:
            raise CommandError("The Codespace seed is forbidden outside development.")
        try:
            student = User.objects.get(email="student@lockin.local")
            institution = EducationNode.objects.get(slug="lockin-demo-university")
            semester = EducationNode.objects.get(slug="fall-2026")
            year = EducationNode.objects.get(
                slug="year-2", kind=EducationNode.Kind.ACADEMIC_YEAR
            )
        except (User.DoesNotExist, EducationNode.DoesNotExist) as error:
            raise CommandError("Run seed_demo first.") from error

        program, _ = AcademicProgram.objects.get_or_create(
            code="codespace-dentistry",
            defaults={"name_en": "Codespace Dentistry", "name_ar": "طب الأسنان"},
        )
        cohort, _ = StudentCohort.objects.get_or_create(
            program=program, code="year-2",
            defaults={"name_en": "Second Year (demo)", "name_ar": "السنة الثانية"},
        )
        cohort.content_nodes.add(year)
        student.cohort = cohort
        student.profile_completion_required = False
        student.welcome_completed_at = timezone.now()
        student.preferred_language = User.Language.ARABIC
        student.save(
            update_fields=[
                "cohort", "profile_completion_required", "welcome_completed_at",
                "preferred_language", "updated_at",
            ]
        )
        profile, _ = StudyPlanProfile.objects.get_or_create(
            user=student,
            defaults={
                "mode": StudyPlanProfile.Mode.NORMAL, "daily_minutes": 120,
                "session_minutes": 25, "weekdays": list(range(7)),
                "habit_baseline_minutes": 60,
            },
        )
        subjects = []
        sheets_count = 0
        question_count = 0
        for position, (slug, title) in enumerate(
            (
                ("oral-anatomy", "Oral Anatomy"),
                ("dental-materials", "Dental Materials"),
                ("oral-pathology", "Oral Pathology"),
            ), 1
        ):
            node = EducationNode.objects.get(parent=semester, slug=slug)
            subject, _ = CatalogSubject.objects.get_or_create(
                source_node=node,
                defaults={
                    "cohort": cohort,
                    "title": title,
                    "slug": slug,
                    "material_slug": f"codespace-year2-{slug}",
                    "position": position,
                },
            )
            if subject.cohort_id != cohort.pk:
                raise CommandError("The demo subject is assigned to another cohort.")
            subjects.append(subject)
            sheets = LearningObject.objects.filter(
                published_version__academic_node__path__startswith=node.path,
                published_version__isnull=False,
                archived_at__isnull=True,
            ).select_related("published_version").prefetch_related(
                "published_version__assets"
            )
            for sheet in sheets:
                version = sheet.published_version
                if version is None:
                    continue
                primary = next(
                    (asset for asset in version.assets.all() if asset.role == "primary"),
                    None,
                )
                if primary is None:
                    continue
                if version.page_count != 1:
                    version.page_count = 1
                    version.save(update_fields=["page_count"])
                file = primary.managed_file
                if file.pdf_page_count != 1:
                    file.pdf_page_count = 1
                    file.save(update_fields=["pdf_page_count"])
                CatalogDocument.objects.get_or_create(
                    version=version, edition="university",
                    defaults={
                        "material_slug": subject.material_slug,
                        "sheet_slug": f"sheet-{str(sheet.pk)[:8]}",
                        "managed_file": file,
                    },
                )
                StudySheetDifficulty.objects.get_or_create(
                    sheet=sheet, defaults={"level": 2 + sheets_count % 4},
                )
                sheets_count += 1
                # Existing demo questions were authored per lesson but not
                # linked to a sheet. Bind only those published exact versions.
                versions = QuestionVersion.objects.filter(
                    academic_node=version.academic_node,
                    source_learning_object__isnull=True,
                ).select_related("question")
                for qversion in versions:
                    if qversion.question.published_version_id != qversion.pk:
                        continue
                    qversion.source_learning_object = sheet
                    qversion.save(update_fields=["source_learning_object"])
                    question_count += 1

        exam, created = ExamPeriod.objects.get_or_create(
            title="Codespace Midterm Preview", cohort=cohort,
            defaults={
                "institution": institution,
                "kind": ExamPeriod.Kind.MIDTERM,
                "starts_on": timezone.localdate() + timedelta(days=35),
                "ends_on": timezone.localdate() + timedelta(days=44),
                "status": ExamPeriod.Status.CONFIRMED,
            },
        )
        for offset, subject in zip((0, 4, 9), subjects, strict=True):
            ExamSyllabusScope.objects.get_or_create(
                period=exam, subject=subject, defaults={"include_future_sheets": True},
            )
            ExamSchedule.objects.get_or_create(
                period=exam, subject=subject, exam_type=ExamSchedule.ExamType.THEORY,
                defaults={
                    "scheduled_on": exam.starts_on + timedelta(days=offset),
                    "status": ExamPeriod.Status.CONFIRMED,
                },
            )
        self.stdout.write(
            self.style.SUCCESS(
                f"Codespace pilot ready: {len(subjects)} subjects, "
                f"{sheets_count} PDF sheets, {question_count} linked questions, "
                f"exam {exam.starts_on}. Student {student.email}. "
                f"Study mode: {profile.mode}. New exam: {created}."
            )
        )

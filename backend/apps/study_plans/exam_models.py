"""Exam ownership and syllabus rules; no copied learner progress lives here."""

import uuid
from typing import Any

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

from apps.content.models import CatalogSubject
from apps.education.models import EducationNode


class ExamPeriod(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        TENTATIVE = "tentative", "Tentative"
        CONFIRMED = "confirmed", "Confirmed"

    class Kind(models.TextChoices):
        MIDTERM = "midterm", "Midterm"
        FINAL = "final", "Final"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=180)
    institution = models.ForeignKey(
        "education.EducationNode",
        on_delete=models.PROTECT,
        limit_choices_to={"kind": "institution"},
        related_name="exam_periods",
    )
    # One period per academic placement. Dates shared by several years are
    # entered separately, so later schedule changes cannot cross cohorts.
    cohort = models.ForeignKey(
        "education.StudentCohort",
        on_delete=models.PROTECT,
        related_name="exam_periods",
    )
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.MIDTERM)
    starts_on = models.DateField()
    ends_on = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("starts_on", "id")
        constraints = [
            models.CheckConstraint(
                condition=Q(ends_on__isnull=True) | Q(ends_on__gte=F("starts_on")),
                name="study_exam_period_date_order",
            )
        ]
        indexes = [
            models.Index(
                fields=("cohort", "status", "starts_on"),
                name="study_exam_cohort_date_idx",
            )
        ]

    def __str__(self) -> str:
        return self.title

    def clean(self) -> None:
        super().clean()
        if self.institution_id and self.institution.kind != EducationNode.Kind.INSTITUTION:
            raise ValidationError({"institution": "Choose an institution."})
        if self.pk and not self._state.adding:
            subjects = CatalogSubject.objects.filter(
                Q(exam_syllabus_scopes__period=self) | Q(exam_schedules__period=self)
            ).select_related("source_node")
            for subject in subjects:
                try:
                    validate_exam_subject(self, subject)
                except ValidationError as error:
                    raise ValidationError(error.messages) from error
            if self.starts_on and (
                self.schedules.filter(scheduled_on__lt=self.starts_on).exists()
                or (self.ends_on and self.schedules.filter(scheduled_on__gt=self.ends_on).exists())
            ):
                raise ValidationError({"starts_on": "Existing exams must stay inside the period."})


def validate_exam_subject(period: ExamPeriod, subject: CatalogSubject) -> None:
    # ModelForm calls clean() even when required parent fields failed validation.
    # Let those field errors render without dereferencing a missing relation.
    if not period.cohort_id or not period.institution_id:
        return
    if subject.cohort_id != period.cohort_id:
        raise ValidationError({"subject": "The subject must belong to the exam cohort."})
    if subject.source_node is None or not subject.source_node.path.startswith(
        period.institution.path
    ):
        raise ValidationError({"subject": "The subject must belong to the exam institution."})


class ExamSchedule(models.Model):
    class ExamType(models.TextChoices):
        THEORY = "theory", "Theory"
        PRACTICAL = "practical", "Practical"
        ORAL = "oral", "Oral"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    period = models.ForeignKey(ExamPeriod, on_delete=models.PROTECT, related_name="schedules")
    subject = models.ForeignKey(
        "content.CatalogSubject",
        on_delete=models.PROTECT,
        related_name="exam_schedules",
    )
    exam_type = models.CharField(max_length=12, choices=ExamType.choices, default=ExamType.THEORY)
    scheduled_on = models.DateField()
    status = models.CharField(
        max_length=12,
        choices=ExamPeriod.Status.choices,
        default=ExamPeriod.Status.TENTATIVE,
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("scheduled_on", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("period", "subject", "exam_type"),
                name="study_exam_subject_type_unique",
            )
        ]

    def __str__(self) -> str:
        return f"{self.subject}: {self.scheduled_on} ({self.exam_type})"

    def clean(self) -> None:
        super().clean()
        if self.period_id and self.subject_id:
            validate_exam_subject(self.period, self.subject)
        if (
            self.period_id
            and self.scheduled_on
            and self.period.starts_on
            and (
                self.scheduled_on < self.period.starts_on
                or (self.period.ends_on and self.scheduled_on > self.period.ends_on)
            )
        ):
            raise ValidationError({"scheduled_on": "The exam must fall inside its period."})


class ExamSyllabusScope(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    period = models.ForeignKey(
        ExamPeriod,
        on_delete=models.PROTECT,
        related_name="syllabus_scopes",
    )
    subject = models.ForeignKey(
        "content.CatalogSubject",
        on_delete=models.PROTECT,
        related_name="exam_syllabus_scopes",
    )
    include_future_sheets = models.BooleanField(default=True)
    # With automatic inclusion off, this explicit list freezes sheet membership;
    # publication/access are still checked every time. Unpublished rows grant nothing.
    sheets: Any = models.ManyToManyField("content.LearningObject", blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("period", "subject"),
                name="study_exam_scope_unique",
            )
        ]

    def __str__(self) -> str:
        return f"{self.period}: {self.subject}"

    def clean(self) -> None:
        super().clean()
        if self.period_id and self.subject_id:
            validate_exam_subject(self.period, self.subject)

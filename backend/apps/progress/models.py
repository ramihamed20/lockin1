import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.content.models import LearningObject, LearningObjectVersion
from apps.education.models import EducationNode
from apps.questions.models import Question, QuestionVersion


class Bookmark(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="learning_bookmarks",
    )
    learning_object = models.ForeignKey(
        LearningObject,
        on_delete=models.CASCADE,
        related_name="bookmarks",
        null=True,
        blank=True,
    )
    catalog_material_slug = models.CharField(max_length=64, blank=True, default="")
    catalog_material_title = models.CharField(max_length=160, blank=True, default="")
    catalog_sheet_slug = models.CharField(max_length=64, blank=True, default="")
    catalog_sheet_title = models.CharField(max_length=240, blank=True, default="")
    position = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "learning_object"),
                condition=Q(learning_object__isnull=False),
                name="progress_bookmark_unique",
            ),
            models.UniqueConstraint(
                fields=("user", "catalog_material_slug", "catalog_sheet_slug"),
                condition=(
                    Q(learning_object__isnull=True)
                    & ~Q(catalog_material_slug="")
                    & ~Q(catalog_sheet_slug="")
                ),
                name="progress_catalog_bookmark_unique",
            ),
            models.CheckConstraint(
                condition=(
                    Q(
                        learning_object__isnull=False,
                        catalog_material_slug="",
                        catalog_sheet_slug="",
                    )
                    | (
                        Q(learning_object__isnull=True)
                        & ~Q(catalog_material_slug="")
                        & ~Q(catalog_sheet_slug="")
                    )
                ),
                name="progress_bookmark_target_valid",
            ),
        ]
        indexes = [models.Index(fields=("user", "-created_at"), name="progress_bookmark_user_idx")]

    def __str__(self) -> str:
        target = self.learning_object_id or (
            f"{self.catalog_material_slug}/{self.catalog_sheet_slug}"
        )
        return f"{self.user_id}:{target}"


class LearningProgress(models.Model):
    class Status(models.TextChoices):
        IN_PROGRESS = "in_progress", "In progress"
        COMPLETED = "completed", "Completed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="learning_progress",
    )
    learning_object = models.ForeignKey(
        LearningObject,
        on_delete=models.PROTECT,
        related_name="progress_records",
    )
    version = models.ForeignKey(
        LearningObjectVersion,
        on_delete=models.PROTECT,
        related_name="progress_records",
    )
    status = models.CharField(max_length=16, choices=Status.choices)
    completion_percent = models.PositiveSmallIntegerField(default=0)
    position = models.JSONField(default=dict, blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "learning_object"),
                name="progress_learning_unique",
            ),
            models.CheckConstraint(
                condition=Q(completion_percent__lte=100),
                name="progress_percent_lte_100",
            ),
            models.CheckConstraint(
                condition=(
                    Q(status="in_progress", completed_at__isnull=True)
                    | Q(status="completed", completed_at__isnull=False, completion_percent=100)
                ),
                name="progress_completion_consistent",
            ),
        ]
        indexes = [
            models.Index(fields=("user", "status", "-updated_at"), name="progress_resume_idx")
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.learning_object_id}:{self.status}"


class LessonProgress(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="lesson_progress",
    )
    lesson = models.ForeignKey(
        EducationNode,
        on_delete=models.PROTECT,
        related_name="student_progress",
    )
    completed_at = models.DateTimeField()
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-completed_at",)
        constraints = [
            models.UniqueConstraint(fields=("user", "lesson"), name="progress_lesson_unique")
        ]
        indexes = [models.Index(fields=("user", "-completed_at"), name="progress_lesson_user_idx")]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.lesson_id}"


class QuestionReview(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="question_reviews",
    )
    question = models.ForeignKey(
        Question,
        on_delete=models.PROTECT,
        related_name="review_schedules",
    )
    last_question_version = models.ForeignKey(
        QuestionVersion,
        on_delete=models.PROTECT,
        related_name="review_schedules",
    )
    due_at = models.DateTimeField()
    interval_days = models.PositiveIntegerField(default=1)
    ease_factor = models.DecimalField(
        max_digits=3,
        decimal_places=2,
        default=Decimal("2.50"),
    )
    repetitions = models.PositiveSmallIntegerField(default=0)
    lapses = models.PositiveSmallIntegerField(default=0)
    last_was_correct = models.BooleanField(default=False)
    last_reviewed_at = models.DateTimeField()
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("due_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "question"),
                name="review_user_question_unique",
            ),
            models.CheckConstraint(
                condition=Q(ease_factor__gte=1.30) & Q(ease_factor__lte=3.00),
                name="review_ease_factor_valid",
            ),
        ]
        indexes = [
            models.Index(fields=("user", "due_at"), name="review_user_due_idx"),
            models.Index(
                fields=("user", "repetitions", "due_at"),
                name="review_mastery_due_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.question_id}:{self.due_at.isoformat()}"


class QuestionReviewLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="question_review_history",
    )
    question = models.ForeignKey(Question, on_delete=models.PROTECT)
    question_version = models.ForeignKey(QuestionVersion, on_delete=models.PROTECT)
    result_id = models.UUIDField()
    attempt_question_id = models.UUIDField()
    was_correct = models.BooleanField()
    previous_state = models.JSONField(default=dict)
    new_state = models.JSONField(default=dict)
    reviewed_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-reviewed_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("result_id", "question"),
                name="review_result_question_unique",
            )
        ]
        indexes = [models.Index(fields=("user", "-reviewed_at"), name="review_history_user_idx")]

    def __str__(self) -> str:
        return f"{self.result_id}:{self.question_id}:{self.was_correct}"

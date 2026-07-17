import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.content.models import LearningObject, LearningObjectVersion
from apps.education.models import EducationNode


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
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "learning_object"),
                name="progress_bookmark_unique",
            )
        ]
        indexes = [models.Index(fields=("user", "-created_at"), name="progress_bookmark_user_idx")]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.learning_object_id}"


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

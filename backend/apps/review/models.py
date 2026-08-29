import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.education.models import EducationNode
from apps.questions.models import Question, QuestionVersion


class ReviewItem(models.Model):
    class State(models.TextChoices):
        ACTIVE = "active_review", "Active review"
        HIDDEN = "hidden_review", "Hidden review"
        MASTERED = "mastered", "Mastered"

    class SourceType(models.TextChoices):
        SHEET = "sheet", "Sheet question"
        QUIZ = "quiz", "Quiz"
        PRACTICE = "practice", "Practice"
        MIX = "mix", "Mix"
        AI = "ai", "AI questions"
        ACTIVE_STUDY = "active_study", "Active Study"
        REVIEW = "review", "Review Bank"
        WEEKLY_RECALL = "weekly_recall", "Weekly Recall"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="review_bank_items",
    )
    canonical_key = models.CharField(max_length=255)
    question = models.ForeignKey(
        Question,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="review_bank_items",
    )
    last_question_version = models.ForeignKey(
        QuestionVersion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="review_bank_items",
    )
    subject = models.ForeignKey(
        EducationNode,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="review_bank_items",
    )
    subject_key = models.CharField(max_length=255)
    subject_label_snapshot = models.CharField(max_length=220)
    source_type = models.CharField(max_length=24, choices=SourceType.choices)
    source_id = models.CharField(max_length=255, blank=True)
    source_label_snapshot = models.CharField(max_length=255, blank=True)
    source_question_index = models.PositiveIntegerField(null=True, blank=True)
    prompt_snapshot = models.TextField()
    explanation_snapshot = models.TextField(blank=True)
    options_snapshot = models.JSONField(default=list)
    correct_option_ids_snapshot = models.JSONField(default=list)
    state = models.CharField(max_length=16, choices=State.choices, default=State.ACTIVE)
    mastery_level = models.PositiveSmallIntegerField(default=0)
    mistake_count = models.PositiveIntegerField(default=0)
    review_correct_count = models.PositiveIntegerField(default=0)
    review_incorrect_count = models.PositiveIntegerField(default=0)
    relearning_count = models.PositiveIntegerField(default=0)
    first_mistake_at = models.DateTimeField()
    last_mistake_at = models.DateTimeField()
    last_reviewed_at = models.DateTimeField(null=True, blank=True)
    next_review_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-last_mistake_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "canonical_key"),
                name="review_item_user_key_unique",
            ),
            models.CheckConstraint(
                condition=Q(mastery_level__gte=0) & Q(mastery_level__lte=4),
                name="review_item_mastery_valid",
            ),
        ]
        indexes = [
            models.Index(
                fields=("user", "state", "-last_mistake_at"),
                name="review_item_user_state_idx",
            ),
            models.Index(
                fields=("user", "state", "subject_key"),
                name="review_item_subject_idx",
            ),
            models.Index(
                fields=("user", "state", "next_review_at"),
                name="review_item_due_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.canonical_key}:{self.state}"


class MistakeEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="mistake_events",
    )
    review_item = models.ForeignKey(
        ReviewItem,
        on_delete=models.PROTECT,
        related_name="mistake_events",
    )
    event_key = models.CharField(max_length=255)
    source_type = models.CharField(max_length=24, choices=ReviewItem.SourceType.choices)
    source_id = models.CharField(max_length=255, blank=True)
    source_label_snapshot = models.CharField(max_length=255, blank=True)
    source_question_index = models.PositiveIntegerField(null=True, blank=True)
    prompt_snapshot = models.TextField()
    selected_answer_snapshot = models.JSONField(default=list)
    correct_answer_snapshot = models.JSONField(default=list)
    answered_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-answered_at", "-created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "event_key"),
                name="mistake_event_user_key_unique",
            )
        ]
        indexes = [
            models.Index(
                fields=("user", "-answered_at"),
                name="mistake_event_recent_idx",
            ),
            models.Index(
                fields=("user", "source_type", "-answered_at"),
                name="mistake_event_source_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.event_key}"


class WeeklyRecallSession(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="weekly_recall_sessions",
    )
    week_key = models.CharField(max_length=10)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    total_questions = models.PositiveSmallIntegerField(default=0)
    correct_answers = models.PositiveSmallIntegerField(default=0)
    started_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-started_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "week_key"),
                name="weekly_recall_user_week_unique",
            )
        ]
        indexes = [
            models.Index(
                fields=("user", "week_key", "status"),
                name="weekly_recall_lookup_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.week_key}:{self.status}"


class WeeklyRecallQuestion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        WeeklyRecallSession,
        on_delete=models.CASCADE,
        related_name="questions",
    )
    review_item = models.ForeignKey(
        ReviewItem,
        on_delete=models.PROTECT,
        related_name="weekly_recall_questions",
    )
    position = models.PositiveSmallIntegerField()
    selected_option_ids = models.JSONField(default=list, blank=True)
    was_correct = models.BooleanField(null=True, blank=True)
    answered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("position", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("session", "position"),
                name="weekly_question_position_unique",
            ),
            models.UniqueConstraint(
                fields=("session", "review_item"),
                name="weekly_question_item_unique",
            ),
        ]
        indexes = [
            models.Index(
                fields=("session", "position"),
                name="weekly_question_order_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.session_id}:{self.position}"


class ReviewAnswerLog(models.Model):
    class Context(models.TextChoices):
        REVIEW_BANK = "review_bank", "Review Bank"
        WEEKLY_RECALL = "weekly_recall", "Weekly Recall"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="review_answer_history",
    )
    review_item = models.ForeignKey(
        ReviewItem,
        on_delete=models.PROTECT,
        related_name="answer_history",
    )
    weekly_question = models.ForeignKey(
        WeeklyRecallQuestion,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="answer_logs",
    )
    idempotency_key = models.UUIDField()
    context = models.CharField(max_length=16, choices=Context.choices)
    selected_option_ids = models.JSONField(default=list)
    was_correct = models.BooleanField()
    answered_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-answered_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "idempotency_key"),
                name="review_answer_user_key_unique",
            )
        ]
        indexes = [
            models.Index(
                fields=("user", "-answered_at"),
                name="review_answer_recent_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.review_item_id}:{self.was_correct}"

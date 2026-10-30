import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

from .exam_models import ExamPeriod, ExamSchedule, ExamSyllabusScope  # noqa: F401


def default_weekdays() -> list[int]:
    return [0, 1, 2, 3, 4]


class StudyPlanProfile(models.Model):
    class Mode(models.TextChoices):
        BEGINNING = "beginning", "Beginning"
        NORMAL = "normal", "Normal"
        CUSTOM = "custom", "Custom"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="study_plan_profile",
    )
    mode = models.CharField(max_length=12, choices=Mode.choices, default=Mode.CUSTOM)
    daily_minutes = models.PositiveSmallIntegerField(default=60)
    session_minutes = models.PositiveSmallIntegerField(default=25)
    weekdays = models.JSONField(default=default_weekdays)
    subjects = models.JSONField(default=list)
    timezone = models.CharField(max_length=80, default="Africa/Tripoli")
    review_minutes = models.PositiveSmallIntegerField(default=2)
    weekly_minutes = models.JSONField(default=dict, blank=True)
    date_minutes = models.JSONField(default=dict, blank=True)
    revision = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(daily_minutes__gte=10, daily_minutes__lte=240),
                name="study_profile_daily_valid",
            ),
            models.CheckConstraint(
                condition=Q(session_minutes__gte=10, session_minutes__lte=120),
                name="study_profile_session_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.mode}"


class PlannerRun(models.Model):
    """Immutable apply receipt; a retry returns the original committed result."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    period = models.ForeignKey(ExamPeriod, on_delete=models.PROTECT)
    client_request_id = models.UUIDField()
    request_digest = models.CharField(max_length=64)
    result = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "client_request_id"), name="planner_apply_request_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.period_id}:{self.pk}"


class StudyPlanItem(models.Model):
    class Activity(models.TextChoices):
        MANUAL = "manual", "Manual session"
        READING = "reading", "Reading"
        ACTIVE_STUDY = "active_study", "Active Study"
        REVIEW = "review", "Review"

    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        COMPLETED = "completed", "Completed"
        SUPERSEDED = "superseded", "Replaced by a newer plan"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="study_plan_items",
    )
    planner_run = models.ForeignKey(PlannerRun, on_delete=models.RESTRICT, null=True, blank=True)
    planning_key = models.CharField(max_length=220, null=True, blank=True)
    catalog_document = models.ForeignKey(
        "content.CatalogDocument", on_delete=models.PROTECT, null=True, blank=True
    )
    source_file = models.ForeignKey(
        "files.ManagedFile", on_delete=models.PROTECT, null=True, blank=True
    )
    review_item = models.ForeignKey(
        "review.ReviewItem", on_delete=models.RESTRICT, null=True, blank=True
    )
    pinned = models.BooleanField(default=False)
    completed_page_end = models.PositiveIntegerField(null=True, blank=True)
    difficulty = models.CharField(max_length=8, default="medium")
    priority_reasons = models.JSONField(default=list, blank=True)
    title = models.CharField(max_length=180)
    subject = models.CharField(max_length=120, blank=True)
    # Additive anchors. Legacy rows stay manual and retain their original text.
    catalog_subject = models.ForeignKey(
        "content.CatalogSubject",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="study_plan_items",
    )
    content_version = models.ForeignKey(
        "content.LearningObjectVersion",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="study_plan_items",
    )
    activity = models.CharField(max_length=16, choices=Activity.choices, default=Activity.MANUAL)
    edition = models.CharField(
        max_length=16,
        choices=(("university", "University Sheet"), ("lockin", "Lockin Sheet")),
        default="university",
    )
    page_start = models.PositiveIntegerField(null=True, blank=True)
    page_end = models.PositiveIntegerField(null=True, blank=True)
    scheduled_date = models.DateField()
    duration_minutes = models.PositiveSmallIntegerField(default=25)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PLANNED)
    completed_at = models.DateTimeField(null=True, blank=True)
    status_changed_at = models.DateTimeField(null=True, blank=True)
    generated_slot = models.PositiveSmallIntegerField(null=True, blank=True)
    plan_mode = models.CharField(max_length=12, default="custom")
    revision = models.PositiveIntegerField(default=1)
    client_request_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("scheduled_date", "created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "planning_key"),
                condition=Q(planning_key__isnull=False),
                name="study_planning_key_unique",
            ),
            models.CheckConstraint(
                condition=Q(planning_key__isnull=True) | Q(planner_run__isnull=False),
                name="study_planning_run_required",
            ),
            models.CheckConstraint(
                condition=(
                    Q(activity="manual")
                    | Q(activity="review", catalog_subject__isnull=False)
                    | Q(
                        activity__in=("reading", "active_study"),
                        catalog_subject__isnull=False,
                        content_version__isnull=False,
                    )
                ),
                name="study_task_activity_target_valid",
            ),
            models.CheckConstraint(
                condition=(
                    Q(page_start__isnull=True, page_end__isnull=True)
                    | Q(
                        content_version__isnull=False,
                        page_start__isnull=False,
                        page_end__isnull=False,
                        page_start__gte=1,
                        page_end__gte=F("page_start"),
                    )
                ),
                name="study_task_page_range_valid",
            ),
            models.UniqueConstraint(
                fields=("user", "client_request_id"),
                condition=Q(client_request_id__isnull=False),
                name="study_request_unique",
            ),
            models.UniqueConstraint(
                fields=("user", "scheduled_date", "generated_slot"),
                condition=Q(generated_slot__isnull=False),
                name="study_generated_slot_unique",
            ),
            models.CheckConstraint(
                condition=(
                    Q(duration_minutes__gte=5) | Q(activity="review", duration_minutes__gte=1)
                )
                & Q(duration_minutes__lte=480),
                name="study_plan_duration_valid",
            ),
        ]
        indexes = [
            models.Index(
                fields=("user", "scheduled_date", "status"),
                name="study_plan_user_date_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.scheduled_date}:{self.title}"

    def clean(self) -> None:
        super().clean()
        version = self.content_version
        subject = self.catalog_subject
        if version is not None and subject is not None:
            node = subject.source_node
            if node is None or not version.academic_node.path.startswith(node.path):
                raise ValidationError({"content_version": "Choose content from this subject."})
        if subject is not None and self.user_id and subject.cohort_id != self.user.cohort_id:
            raise ValidationError({"catalog_subject": "Choose a subject from this cohort."})


class StudyEvidence(models.Model):
    """Explicit reading/time reports; never inferred from a PDF position or timer."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    task = models.ForeignKey(StudyPlanItem, null=True, blank=True, on_delete=models.SET_NULL)
    content_version = models.ForeignKey(
        "content.LearningObjectVersion", null=True, blank=True, on_delete=models.PROTECT
    )
    source_file = models.ForeignKey(
        "files.ManagedFile", null=True, blank=True, on_delete=models.PROTECT
    )
    edition = models.CharField(max_length=16, default="university")
    activity = models.CharField(max_length=16, default="reading")
    page_start = models.PositiveIntegerField(null=True, blank=True)
    page_end = models.PositiveIntegerField(null=True, blank=True)
    minutes = models.PositiveSmallIntegerField(default=0)
    reserved_minutes = models.PositiveSmallIntegerField(default=0)
    client_request_id = models.UUIDField()
    request_digest = models.CharField(max_length=64)
    result = models.JSONField(default=dict)
    occurred_on = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "client_request_id"), name="study_evidence_request_unique"
            ),
            models.CheckConstraint(
                condition=Q(minutes__lte=480), name="study_evidence_minutes_valid"
            ),
            models.CheckConstraint(
                condition=(
                    Q(page_start__isnull=True, page_end__isnull=True)
                    | Q(
                        content_version__isnull=False,
                        source_file__isnull=False,
                        page_start__gte=1,
                        page_end__gte=F("page_start"),
                    )
                ),
                name="study_evidence_pages_valid",
            ),
        ]
        indexes = [
            models.Index(
                fields=("user", "content_version", "source_file"), name="study_evidence_target_idx"
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.client_request_id}"

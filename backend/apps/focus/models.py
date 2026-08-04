import uuid
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q
from django.utils import timezone


def focus_team_invite_code() -> str:
    """A short shareable code; uniqueness is also enforced by the database."""
    return uuid.uuid4().hex[:8].upper()


class FocusTeam(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=80)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_focus_teams"
    )
    invite_code = models.CharField(max_length=12, unique=True, db_index=True, default=focus_team_invite_code)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at", "name")

    def clean(self) -> None:
        super().clean()
        self.name = self.name.strip()
        if not self.name:
            raise ValidationError({"name": "A team name is required."})

    def __str__(self) -> str:
        return self.name


class FocusTeamMembership(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        MEMBER = "member", "Member"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    team = models.ForeignKey(FocusTeam, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="focus_team_memberships"
    )
    role = models.CharField(max_length=12, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("joined_at", "id")
        constraints = [
            models.UniqueConstraint(fields=("team", "user"), name="focus_team_member_unique")
        ]

    def __str__(self) -> str:
        return f"{self.team_id}:{self.user_id}"


class FocusTeamMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    team = models.ForeignKey(FocusTeam, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="focus_team_messages"
    )
    body = models.CharField(max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("created_at", "id")
        indexes = [models.Index(fields=("team", "-created_at"), name="focus_team_message_idx")]

    def clean(self) -> None:
        super().clean()
        self.body = self.body.strip()
        if not self.body:
            raise ValidationError({"body": "A message is required."})

    def __str__(self) -> str:
        return f"{self.team_id}:{self.author_id}:{self.created_at.isoformat()}"


class FocusSession(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        ON_BREAK = "on_break", "On break"
        COMPLETED = "completed", "Completed"
        ABANDONED = "abandoned", "Abandoned"

    class SessionType(models.TextChoices):
        TIMED = "timed", "Timed"
        OPEN_ENDED = "open_ended", "Open ended"
        MATERIAL = "material", "Material based"
        TASK = "task", "Task based"

    class ContextType(models.TextChoices):
        INDEPENDENT = "independent", "Independent"
        STUDY = "study", "Study"
        QUIZ = "quiz", "Quiz"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="focus_sessions"
    )
    context_type = models.CharField(
        max_length=16, choices=ContextType.choices, default=ContextType.INDEPENDENT
    )
    context_id = models.UUIDField(null=True, blank=True)
    client_instance_id = models.UUIDField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    started_at = models.DateTimeField(default=timezone.now)
    last_activity_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)
    planned_duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    break_duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    session_type = models.CharField(
        max_length=16, choices=SessionType.choices, default=SessionType.TIMED
    )
    team_name = models.CharField(max_length=80, blank=True)
    team = models.ForeignKey(
        FocusTeam,
        on_delete=models.SET_NULL,
        related_name="sessions",
        null=True,
        blank=True,
    )
    goal = models.CharField(max_length=280, blank=True)
    topic = models.CharField(max_length=280, blank=True)
    active_duration_seconds = models.PositiveIntegerField(default=0)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-started_at",)
        indexes = [
            models.Index(fields=("user", "-started_at"), name="focus_user_started_idx"),
            models.Index(fields=("status", "-started_at"), name="focus_status_started_idx"),
            models.Index(
                fields=("user", "status", "-last_activity_at"),
                name="focus_user_activity_idx",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("user", "client_instance_id"),
                condition=Q(client_instance_id__isnull=False),
                name="focus_user_client_instance_unique",
            ),
            models.CheckConstraint(
                condition=(
                    Q(context_type="independent", context_id__isnull=True)
                    | (~Q(context_type="independent") & Q(context_id__isnull=False))
                ),
                name="focus_context_reference_valid",
            ),
            models.CheckConstraint(
                condition=Q(ended_at__isnull=True) | Q(ended_at__gte=F("started_at")),
                name="focus_end_after_start",
            ),
            models.CheckConstraint(
                condition=(
                    Q(status__in=("active", "paused", "on_break"), ended_at__isnull=True)
                    | Q(status__in=("completed", "abandoned"), ended_at__isnull=False)
                ),
                name="focus_status_end_consistent",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.started_at.isoformat()}"

    def clean(self) -> None:
        super().clean()
        if self.context_type == self.ContextType.INDEPENDENT and self.context_id is not None:
            raise ValidationError({"context_id": "Independent sessions cannot have context_id."})
        if self.context_type != self.ContextType.INDEPENDENT and self.context_id is None:
            raise ValidationError({"context_id": "Study and quiz sessions require context_id."})


class FocusSessionActivity(models.Model):
    class ActivityType(models.TextChoices):
        STARTED = "started", "Started"
        PAUSED = "paused", "Paused"
        RESUMED = "resumed", "Resumed"
        BREAK_STARTED = "break_started", "Break started"
        BREAK_ENDED = "break_ended", "Break ended"
        COMPLETED = "completed", "Completed"
        ABANDONED = "abandoned", "Abandoned"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(FocusSession, on_delete=models.CASCADE, related_name="timeline")
    sequence = models.PositiveIntegerField()
    activity_type = models.CharField(max_length=16, choices=ActivityType.choices)
    occurred_at = models.DateTimeField(default=timezone.now)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("sequence",)
        constraints = [
            models.UniqueConstraint(
                fields=("session", "sequence"), name="focus_timeline_sequence_unique"
            )
        ]
        indexes = [models.Index(fields=("session", "occurred_at"), name="focus_timeline_time_idx")]

    def __str__(self) -> str:
        return f"{self.session_id}:{self.sequence}:{self.activity_type}"


class FocusSessionNote(models.Model):
    """The latest durable session note. Its revision makes autosave conflict-safe."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.OneToOneField(
        FocusSession, on_delete=models.CASCADE, related_name="session_note"
    )
    body = models.TextField(blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.session_id}:{self.revision}"


class FocusSessionTask(models.Model):
    """A small, user-owned task list kept with a Focus session."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(FocusSession, on_delete=models.CASCADE, related_name="tasks")
    client_task_id = models.UUIDField(null=True, blank=True)
    title = models.CharField(max_length=280)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("session", "client_task_id"),
                condition=Q(client_task_id__isnull=False),
                name="focus_session_client_task_unique",
            )
        ]

    def __str__(self) -> str:
        return f"{self.session_id}:{self.title}"


class FocusWorkspaceSnapshot(models.Model):
    class Sidebar(models.TextChoices):
        CLOSED = "closed", "Closed"
        THUMBNAILS = "thumbnails", "Thumbnails"
        NOTES = "notes", "Notes"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.OneToOneField(
        FocusSession,
        on_delete=models.CASCADE,
        related_name="workspace",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="focus_workspaces",
    )
    document_id = models.UUIDField()
    document_version_id = models.UUIDField()
    file_id = models.UUIDField()
    current_page = models.PositiveIntegerField(default=1)
    page_count = models.PositiveIntegerField(null=True, blank=True)
    zoom = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("1.00"))
    sidebar = models.CharField(
        max_length=16,
        choices=Sidebar.choices,
        default=Sidebar.CLOSED,
    )
    active_tool = models.CharField(max_length=32, blank=True)
    layout = models.JSONField(default=dict, blank=True)
    open_tabs = models.JSONField(default=list, blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)
        indexes = [
            models.Index(
                fields=("user", "document_version_id", "-updated_at"),
                name="focus_workspace_restore_idx",
            )
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(current_page__gte=1),
                name="focus_workspace_page_positive",
            ),
            models.CheckConstraint(
                condition=Q(page_count__isnull=True) | Q(page_count__gte=1),
                name="focus_workspace_page_count_positive",
            ),
            models.CheckConstraint(
                condition=Q(zoom__gte=Decimal("0.50")) & Q(zoom__lte=Decimal("4.00")),
                name="focus_workspace_zoom_range",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.document_version_id}:{self.revision}"


class FocusAnnotationCollection(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="focus_annotation_collections",
    )
    document_id = models.UUIDField()
    document_version_id = models.UUIDField()
    revision = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "document_version_id"),
                name="focus_annotation_collection_unique",
            )
        ]
        indexes = [
            models.Index(
                fields=("user", "document_version_id"),
                name="focus_annotation_owner_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.document_version_id}:{self.revision}"


class FocusAnnotation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    collection = models.ForeignKey(
        FocusAnnotationCollection,
        on_delete=models.CASCADE,
        related_name="annotations",
    )
    page_number = models.PositiveIntegerField()
    tool = models.CharField(max_length=32)
    layer_key = models.CharField(max_length=64, default="personal")
    bounds = models.JSONField(default=dict)
    payload = models.JSONField(default=dict)
    color = models.CharField(max_length=16)
    thickness = models.DecimalField(max_digits=6, decimal_places=2)
    opacity = models.DecimalField(max_digits=4, decimal_places=3)
    revision = models.PositiveBigIntegerField(default=1)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("page_number", "created_at", "id")
        indexes = [
            models.Index(
                fields=("collection", "page_number", "deleted_at"),
                name="focus_annotation_page_idx",
            ),
            models.Index(
                fields=("collection", "updated_at"),
                name="focus_annotation_sync_idx",
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(page_number__gte=1),
                name="focus_annotation_page_positive",
            ),
            models.CheckConstraint(
                condition=Q(thickness__gt=Decimal("0")) & Q(thickness__lte=Decimal("64")),
                name="focus_annotation_thickness_range",
            ),
            models.CheckConstraint(
                condition=Q(opacity__gte=Decimal("0")) & Q(opacity__lte=Decimal("1")),
                name="focus_annotation_opacity_range",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.collection_id}:{self.page_number}:{self.tool}:{self.id}"


class FocusSyncReceipt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    collection = models.ForeignKey(
        FocusAnnotationCollection,
        on_delete=models.CASCADE,
        related_name="sync_receipts",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="focus_sync_receipts",
    )
    idempotency_key = models.UUIDField()
    request_digest = models.CharField(max_length=64)
    response_payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("collection", "idempotency_key"),
                name="focus_sync_receipt_unique",
            )
        ]
        indexes = [
            models.Index(
                fields=("collection", "-created_at"),
                name="focus_sync_receipt_time_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.collection_id}:{self.idempotency_key}"

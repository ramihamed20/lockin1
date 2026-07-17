import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q


class EducationNode(models.Model):
    class Kind(models.TextChoices):
        INSTITUTION = "institution", "Institution"
        COLLEGE = "college", "College or faculty"
        DEPARTMENT = "department", "Department"
        ACADEMIC_YEAR = "academic_year", "Academic year"
        SEMESTER = "semester", "Semester"
        SUBJECT = "subject", "Subject"
        UNIT = "unit", "Unit or chapter"
        LESSON = "lesson", "Lesson"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="children",
    )
    kind = models.CharField(max_length=24, choices=Kind.choices)
    title = models.CharField(max_length=180)
    slug = models.CharField(max_length=180)
    description = models.TextField(blank=True)
    position = models.PositiveIntegerField(default=0)
    path = models.CharField(max_length=2048, unique=True, editable=False)
    depth = models.PositiveSmallIntegerField(default=0, editable=False)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    is_discoverable = models.BooleanField(default=False, editable=False)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("position", "title", "id")
        indexes = [
            models.Index(
                fields=("parent", "is_discoverable", "position"),
                name="edu_parent_discovery_idx",
            ),
            models.Index(
                fields=("kind", "is_discoverable", "title"),
                name="edu_kind_discovery_idx",
            ),
            models.Index(fields=("path",), name="edu_path_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("parent", "slug"),
                condition=Q(parent__isnull=False),
                name="edu_sibling_slug_unique",
            ),
            models.UniqueConstraint(
                fields=("slug",),
                condition=Q(parent__isnull=True),
                name="edu_root_slug_unique",
            ),
            models.CheckConstraint(
                condition=~Q(id=F("parent_id")),
                name="edu_node_not_own_parent",
            ),
        ]

    def __str__(self) -> str:
        return self.title

    def clean(self) -> None:
        super().clean()
        self.title = self.title.strip()
        self.slug = self.slug.strip().lower()
        self.description = self.description.strip()
        if self.parent_id == self.id:
            raise ValidationError({"parent": "A node cannot be its own parent."})
        if self.parent_id is None and self.kind != self.Kind.INSTITUTION:
            raise ValidationError({"parent": "Only an institution can be a root node."})
        if self.parent_id is not None and self.kind == self.Kind.INSTITUTION:
            raise ValidationError({"parent": "An institution must be a root node."})


class CreatorScope(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="education_scopes",
    )
    node = models.ForeignKey(EducationNode, on_delete=models.CASCADE, related_name="creator_scopes")
    can_create_content = models.BooleanField(default=True)
    can_review_content = models.BooleanField(default=False)
    can_publish_content = models.BooleanField(default=False)
    can_manage_hierarchy = models.BooleanField(default=False)
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="granted_education_scopes",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("node__path", "user_id")
        constraints = [
            models.UniqueConstraint(fields=("user", "node"), name="edu_creator_scope_unique"),
            models.CheckConstraint(
                condition=(
                    Q(can_create_content=True)
                    | Q(can_review_content=True)
                    | Q(can_publish_content=True)
                    | Q(can_manage_hierarchy=True)
                ),
                name="edu_scope_has_capability",
            ),
        ]
        indexes = [models.Index(fields=("user", "node"), name="edu_scope_user_node_idx")]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.node_id}"

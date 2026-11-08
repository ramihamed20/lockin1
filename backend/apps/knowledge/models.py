"""Shared concepts and private student work. Progression belongs to existing domains."""

import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q


class StudyToolSettings(models.Model):
    sheet = models.OneToOneField("content.LearningObject", on_delete=models.CASCADE)

    summary_enabled = models.BooleanField(default=True)
    map_enabled = models.BooleanField(default=True)
    explain_enabled = models.BooleanField(default=True)

    def __str__(self) -> str:
        return str(self.sheet_id)


class Concept(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sheet = models.ForeignKey("content.LearningObject", on_delete=models.PROTECT)
    title = models.CharField(max_length=220)
    description = models.TextField(blank=True)
    published = models.BooleanField(default=False)

    def __str__(self) -> str:
        return self.title


class ConceptSource(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    concept = models.ForeignKey(Concept, on_delete=models.CASCADE, related_name="sources")
    document = models.ForeignKey("content.CatalogDocument", on_delete=models.PROTECT)
    source_version = models.ForeignKey("content.LearningObjectVersion", on_delete=models.PROTECT)
    source_file = models.ForeignKey("files.ManagedFile", on_delete=models.PROTECT)

    page_start = models.PositiveIntegerField()
    page_end = models.PositiveIntegerField()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(page_start__gte=1) & Q(page_end__gte=F("page_start")),
                name="knowledge_source_range_valid",
            )
        ]

    def __str__(self) -> str:
        return str(self.id)


class StudentArtifact(models.Model):
    """Nodes and strokes stay in one bounded, atomic editor snapshot."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    document = models.ForeignKey("content.CatalogDocument", on_delete=models.PROTECT)
    source_version = models.ForeignKey("content.LearningObjectVersion", on_delete=models.PROTECT)
    source_file = models.ForeignKey("files.ManagedFile", on_delete=models.PROTECT)
    kind = models.CharField(max_length=12, choices=[("summary", "Summary"), ("map", "Map")])
    title = models.CharField(max_length=220)

    page_start = models.PositiveIntegerField()
    page_end = models.PositiveIntegerField()
    content = models.JSONField(default=dict)
    linked_concept_ids = models.JSONField(default=list)
    revision = models.PositiveBigIntegerField(default=1)
    deleted = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["owner", "document"], name="knowledge_artifact_owner_idx")]
        constraints = [
            models.CheckConstraint(
                condition=Q(page_start__gte=1) & Q(page_end__gte=F("page_start")),
                name="knowledge_artifact_range_valid",
            )
        ]

    def __str__(self) -> str:
        return str(self.id)


class ArtifactReceipt(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    mutation_id = models.UUIDField()

    digest = models.CharField(max_length=64)
    response = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "mutation_id"],
                name="knowledge_mutation_owner_unique",
            )
        ]

    def __str__(self) -> str:
        return str(self.mutation_id)


class ExplainQuestion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.ForeignKey(ConceptSource, on_delete=models.PROTECT)
    concepts = models.ManyToManyField(Concept, blank=True)
    difficulty = models.CharField(
        max_length=12,
        choices=[
            ("easy", "Easy"),
            ("medium", "Medium"),
            ("hard", "Hard"),
        ],
    )
    prompt = models.TextField(max_length=4000)
    reference_answer = models.TextField(max_length=10000)
    essential_points = models.JSONField(default=list)
    alternatives = models.JSONField(default=list, blank=True)
    follow_ups = models.JSONField(default=list, blank=True)
    published = models.BooleanField(default=False)
    revision = models.PositiveBigIntegerField(default=1)

    def __str__(self) -> str:
        return self.prompt[:100]


class ExplainAttempt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    question = models.ForeignKey(ExplainQuestion, on_delete=models.PROTECT)
    source = models.ForeignKey(ConceptSource, on_delete=models.PROTECT, null=True, blank=True)

    question_revision = models.PositiveBigIntegerField()
    answer = models.TextField(max_length=10000)
    feedback = models.JSONField()
    evaluation_status = models.CharField(max_length=24, default="self_review")
    self_rating = models.CharField(max_length=16, blank=True)
    confidence = models.CharField(max_length=12, blank=True)
    error_reason = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return str(self.id)


class McqConceptLink(models.Model):
    """Explicit Review Bank identity. Replaced banks require an explicit remap."""

    concept = models.ForeignKey(Concept, on_delete=models.CASCADE, related_name="mcq_links")
    canonical_key = models.CharField(max_length=255)

    bank_revision = models.PositiveBigIntegerField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["concept", "canonical_key"], name="knowledge_mcq_concept_unique"
            )
        ]

    def __str__(self) -> str:
        return self.canonical_key

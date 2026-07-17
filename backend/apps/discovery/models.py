import uuid

from django.db import models


class SearchEntry(models.Model):
    """A rebuildable discovery projection, never the authorization source of truth."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    resource_kind = models.CharField(max_length=32)
    resource_id = models.UUIDField()
    content_type = models.CharField(max_length=32, blank=True)
    title = models.CharField(max_length=220)
    normalized_title = models.CharField(max_length=220, db_index=True)
    summary = models.TextField(blank=True)
    language = models.CharField(max_length=12, default="und")
    academic_path = models.CharField(max_length=2048, db_index=True)
    is_discoverable = models.BooleanField(default=True)
    published_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("title", "resource_kind", "resource_id")
        constraints = [
            models.UniqueConstraint(
                fields=("resource_kind", "resource_id"),
                name="discovery_resource_unique",
            )
        ]
        indexes = [
            models.Index(
                fields=("is_discoverable", "resource_kind", "content_type"),
                name="discovery_filter_idx",
            ),
            models.Index(
                fields=("is_discoverable", "-published_at", "id"),
                name="discovery_recent_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.resource_kind}:{self.title}"


class SearchTerm(models.Model):
    entry = models.ForeignKey(SearchEntry, on_delete=models.CASCADE, related_name="terms")
    term = models.CharField(max_length=80, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("entry", "term"), name="discovery_term_unique")
        ]
        indexes = [models.Index(fields=("term", "entry"), name="discovery_term_entry_idx")]

    def __str__(self) -> str:
        return self.term

import uuid
from pathlib import Path

from django.conf import settings
from django.db import models


def managed_upload_path(instance: "ManagedFile", filename: str) -> str:
    suffix = Path(filename).suffix.lower()[:10]
    return f"managed/{instance.kind}/{instance.id}{suffix}"


class ManagedFile(models.Model):
    class Kind(models.TextChoices):
        PDF = "pdf", "PDF document"
        AUDIO = "audio", "Audio"

    class ValidationStatus(models.TextChoices):
        READY = "ready", "Validated"
        REJECTED = "rejected", "Rejected"

    class ScanStatus(models.TextChoices):
        NOT_CONFIGURED = "not_configured", "Scanner not configured"
        PENDING = "pending", "Pending scan"
        CLEAN = "clean", "Clean"
        QUARANTINED = "quarantined", "Quarantined"
        FAILED = "failed", "Scan failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="managed_files",
    )
    kind = models.CharField(max_length=16, choices=Kind.choices)
    blob = models.FileField(upload_to=managed_upload_path, max_length=512)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size_bytes = models.PositiveBigIntegerField()
    checksum_sha256 = models.CharField(max_length=64, db_index=True)
    validation_status = models.CharField(
        max_length=16,
        choices=ValidationStatus.choices,
        default=ValidationStatus.READY,
    )
    scan_status = models.CharField(
        max_length=24,
        choices=ScanStatus.choices,
        default=ScanStatus.NOT_CONFIGURED,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=("owner", "-created_at"), name="files_owner_created_idx"),
            models.Index(
                fields=("validation_status", "scan_status"),
                name="files_processing_idx",
            ),
        ]

    def __str__(self) -> str:
        return self.original_name

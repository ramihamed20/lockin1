import uuid

from django.conf import settings
from django.db import models


class ReportExport(models.Model):
    class OutputFormat(models.TextChoices):
        CSV = "csv", "CSV"
        XLSX = "xlsx", "Excel workbook"
    class Status(models.TextChoices):
        PREVIEWED = "previewed", "Previewed"
        COMPLETED = "completed", "Completed"
        EXPIRED = "expired", "Expired"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report_code = models.CharField(max_length=60)
    output_format = models.CharField(
        max_length=8, choices=OutputFormat.choices, default=OutputFormat.CSV
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="report_exports"
    )
    filters = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PREVIEWED)
    estimated_rows = models.PositiveIntegerField(default=0)
    row_count = models.PositiveIntegerField(null=True, blank=True)
    truncated = models.BooleanField(default=False)
    confirmation_digest = models.CharField(max_length=64, editable=False)
    content_digest = models.CharField(max_length=64, blank=True, editable=False)
    expires_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=("requested_by", "-created_at"), name="reports_user_time_idx"),
            models.Index(fields=("report_code", "-created_at"), name="reports_code_time_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.report_code}:{self.id}:{self.status}"

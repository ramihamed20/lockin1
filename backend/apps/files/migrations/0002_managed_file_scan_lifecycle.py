from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("files", "0001_initial")]

    operations = [
        migrations.AlterField(
            model_name="managedfile",
            name="kind",
            field=models.CharField(
                choices=[
                    ("pdf", "PDF document"),
                    ("audio", "Audio"),
                    ("avatar", "Profile avatar"),
                ],
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="managedfile",
            name="scan_status",
            field=models.CharField(
                choices=[
                    ("not_configured", "Scanner not configured"),
                    ("pending", "Pending scan"),
                    ("scanning", "Scan in progress"),
                    ("clean", "Clean"),
                    ("quarantined", "Quarantined"),
                    ("failed", "Scan failed"),
                ],
                default="not_configured",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="managedfile",
            name="scan_attempts",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="managedfile",
            name="scan_completed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="managedfile",
            name="scan_engine",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="managedfile",
            name="scan_error_code",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="managedfile",
            name="scan_next_attempt_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="managedfile",
            name="scan_requested_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="managedfile",
            name="scan_signature",
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AddField(
            model_name="managedfile",
            name="scan_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="managedfile",
            index=models.Index(
                fields=["scan_status", "scan_next_attempt_at", "created_at"],
                name="files_scan_queue_idx",
            ),
        ),
    ]

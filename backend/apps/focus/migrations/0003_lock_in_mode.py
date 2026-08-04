# Generated manually for the persisted Lock In Mode lifecycle.

import django.db.models.deletion
import uuid

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("focus", "0002_focusannotation_focusannotationcollection_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="focussession",
            name="break_duration_seconds",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="focussession",
            name="goal",
            field=models.CharField(blank=True, max_length=280),
        ),
        migrations.AddField(
            model_name="focussession",
            name="session_type",
            field=models.CharField(
                choices=[
                    ("timed", "Timed"),
                    ("open_ended", "Open ended"),
                    ("material", "Material based"),
                    ("task", "Task based"),
                ],
                default="timed",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="focussession",
            name="topic",
            field=models.CharField(blank=True, max_length=280),
        ),
        migrations.AlterField(
            model_name="focussession",
            name="status",
            field=models.CharField(
                choices=[
                    ("active", "Active"),
                    ("paused", "Paused"),
                    ("on_break", "On break"),
                    ("completed", "Completed"),
                    ("abandoned", "Abandoned"),
                ],
                default="active",
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="focussessionactivity",
            name="activity_type",
            field=models.CharField(
                choices=[
                    ("started", "Started"),
                    ("paused", "Paused"),
                    ("resumed", "Resumed"),
                    ("break_started", "Break started"),
                    ("break_ended", "Break ended"),
                    ("completed", "Completed"),
                    ("abandoned", "Abandoned"),
                ],
                max_length=16,
            ),
        ),
        migrations.RemoveConstraint(model_name="focussession", name="focus_status_end_consistent"),
        migrations.AddConstraint(
            model_name="focussession",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("ended_at__isnull", True), ("status__in", ("active", "paused", "on_break"))),
                    models.Q(("ended_at__isnull", False), ("status__in", ("completed", "abandoned"))),
                    _connector="OR",
                ),
                name="focus_status_end_consistent",
            ),
        ),
        migrations.CreateModel(
            name="FocusSessionNote",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("body", models.TextField(blank=True)),
                ("revision", models.PositiveBigIntegerField(default=1)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "session",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="session_note",
                        to="focus.focussession",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="FocusSessionTask",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("client_task_id", models.UUIDField(blank=True, null=True)),
                ("title", models.CharField(max_length=280)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="tasks",
                        to="focus.focussession",
                    ),
                ),
            ],
            options={"ordering": ("created_at", "id")},
        ),
        migrations.AddConstraint(
            model_name="focussessiontask",
            constraint=models.UniqueConstraint(
                condition=models.Q(("client_task_id__isnull", False)),
                fields=("session", "client_task_id"),
                name="focus_session_client_task_unique",
            ),
        ),
    ]

import django.db.models.deletion
import uuid

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("content", "0004_activestudyquestioncontent"),
        ("focus", "0006_active_study_run"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="activestudyrun",
            name="completed_parts",
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name="activestudyrun",
            name="current_part",
            field=models.PositiveSmallIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="activestudyrun",
            name="plan_signature",
            field=models.JSONField(default=dict),
        ),
        migrations.AddField(
            model_name="activestudyrun",
            name="sheet",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="active_study_runs",
                to="content.learningobject",
            ),
        ),
        migrations.AddField(
            model_name="activestudyrun",
            name="stage",
            field=models.CharField(
                choices=[
                    ("reading", "Reading"),
                    ("checkpoint", "Checkpoint"),
                    ("checkpoint_result", "Checkpoint result"),
                    ("final", "Final exam"),
                    ("final_result", "Final exam result"),
                ],
                default="reading",
                max_length=24,
            ),
        ),
        migrations.AddIndex(
            model_name="activestudyrun",
            index=models.Index(
                fields=["user", "sheet", "difficulty", "status", "-updated_at"],
                name="focus_active_sheet_idx",
            ),
        ),
        migrations.CreateModel(
            name="ActiveStudyAttempt",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("kind", models.CharField(choices=[("checkpoint", "Checkpoint"), ("final", "Final exam")], max_length=16)),
                ("part_number", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("number", models.PositiveSmallIntegerField()),
                ("score", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("total", models.PositiveSmallIntegerField()),
                ("passed", models.BooleanField(blank=True, null=True)),
                ("continued_anyway", models.BooleanField(default=False)),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("run", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="attempts", to="focus.activestudyrun")),
            ],
            options={"ordering": ("number", "created_at")},
        ),
        migrations.CreateModel(
            name="ActiveStudyAnswer",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("question_position", models.PositiveSmallIntegerField()),
                ("selected_answer", models.CharField(max_length=1)),
                ("was_correct", models.BooleanField()),
                ("answered_at", models.DateTimeField(auto_now_add=True)),
                ("attempt", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="answers", to="focus.activestudyattempt")),
            ],
            options={"ordering": ("question_position",)},
        ),
        migrations.AddConstraint(
            model_name="activestudyattempt",
            constraint=models.UniqueConstraint(fields=("run", "kind", "part_number", "number"), name="focus_active_attempt_unique"),
        ),
        migrations.AddConstraint(
            model_name="activestudyanswer",
            constraint=models.UniqueConstraint(fields=("attempt", "question_position"), name="focus_active_answer_unique"),
        ),
    ]

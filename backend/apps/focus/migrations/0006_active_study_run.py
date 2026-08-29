import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("focus", "0005_lock_in_teams"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ActiveStudyRun",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("material_slug", models.SlugField(max_length=80)),
                ("sheet_slug", models.SlugField(max_length=80)),
                (
                    "difficulty",
                    models.CharField(
                        choices=[("easy", "Easy"), ("medium", "Medium"), ("hard", "Hard")],
                        max_length=12,
                    ),
                ),
                ("page_count", models.PositiveIntegerField()),
                ("unlocked_pages", models.PositiveIntegerField(default=3)),
                (
                    "status",
                    models.CharField(
                        choices=[("active", "Active"), ("completed", "Completed")],
                        default="active",
                        max_length=16,
                    ),
                ),
                ("last_score", models.PositiveIntegerField(blank=True, null=True)),
                ("last_outcome", models.CharField(blank=True, max_length=24)),
                ("checkpoint_attempts", models.PositiveIntegerField(default=0)),
                ("final_attempts", models.PositiveIntegerField(default=0)),
                ("xp_awarded", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="active_study_runs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ("-updated_at",)},
        ),
        migrations.AddIndex(
            model_name="activestudyrun",
            index=models.Index(
                fields=["user", "material_slug", "sheet_slug", "status", "-updated_at"],
                name="focus_active_study_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="activestudyrun",
            constraint=models.CheckConstraint(
                condition=models.Q(("page_count__gte", 1)), name="active_study_page_count_positive"
            ),
        ),
        migrations.AddConstraint(
            model_name="activestudyrun",
            constraint=models.CheckConstraint(
                condition=models.Q(("unlocked_pages__gte", 1)),
                name="active_study_unlocked_positive",
            ),
        ),
    ]

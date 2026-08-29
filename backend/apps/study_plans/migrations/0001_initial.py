import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name="StudyPlanItem",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(max_length=180)),
                ("subject", models.CharField(blank=True, max_length=120)),
                ("scheduled_date", models.DateField()),
                ("duration_minutes", models.PositiveSmallIntegerField(default=25)),
                ("status", models.CharField(choices=[("planned", "Planned"), ("completed", "Completed")], default="planned", max_length=12)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="study_plan_items", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("scheduled_date", "created_at", "id")},
        ),
        migrations.AddConstraint(
            model_name="studyplanitem",
            constraint=models.CheckConstraint(condition=models.Q(("duration_minutes__gte", 5), ("duration_minutes__lte", 480)), name="study_plan_duration_valid"),
        ),
        migrations.AddIndex(
            model_name="studyplanitem",
            index=models.Index(fields=["user", "scheduled_date", "status"], name="study_plan_user_date_idx"),
        ),
    ]

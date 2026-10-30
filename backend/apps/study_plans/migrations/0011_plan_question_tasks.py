from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("study_plans", "0010_study_habits_and_sheet_difficulty"),
    ]

    operations = [
        migrations.AddField(
            model_name="studyplanitem",
            name="question_ids",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="studyplanitem",
            name="question_source",
            field=models.CharField(
                blank=True, default="", max_length=12,
                choices=[("ai-sheet", "Sheet questions"), ("exam", "Past exams")],
            ),
        ),
        migrations.AlterField(
            model_name="studyplanitem",
            name="activity",
            field=models.CharField(
                max_length=16, default="manual",
                choices=[
                    ("manual", "Manual session"),
                    ("reading", "Reading"),
                    ("active_study", "Active Study"),
                    ("questions", "Sheet questions"),
                    ("review", "Review"),
                ],
            ),
        ),
        migrations.RemoveConstraint(
            model_name="studyplanitem", name="study_task_activity_target_valid",
        ),
        migrations.AddConstraint(
            model_name="studyplanitem",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(activity="manual")
                    | models.Q(activity="review", catalog_subject__isnull=False)
                    | models.Q(
                        activity__in=("reading", "active_study", "questions"),
                        catalog_subject__isnull=False,
                        content_version__isnull=False,
                    )
                ),
                name="study_task_activity_target_valid",
            ),
        ),
    ]

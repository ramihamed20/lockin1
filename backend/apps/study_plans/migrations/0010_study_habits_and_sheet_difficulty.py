from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("content", "0020_sheetpagetranslation"),
        ("study_plans", "0009_remove_studyplanitem_study_plan_duration_valid_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="studyplanprofile",
            name="habit_baseline_minutes",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="studyplanprofile",
            name="habit_block_minutes",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="studyplanprofile",
            name="study_rhythm",
            field=models.CharField(
                max_length=12, default="mixed",
                choices=[("mixed", "Flexible"), ("fragmented", "Short sessions"), ("continuous", "Long sessions")],
            ),
        ),
        migrations.AddField(
            model_name="studyplanprofile",
            name="gradual_growth",
            field=models.BooleanField(default=True),
        ),
        migrations.CreateModel(
            name="StudySheetDifficulty",
            fields=[
                ("sheet", models.OneToOneField(
                    to="content.learningobject", primary_key=True, serialize=False,
                    related_name="study_difficulty", on_delete=django.db.models.deletion.CASCADE,
                )),
                ("level", models.PositiveSmallIntegerField(default=3)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.AddConstraint(
            model_name="studysheetdifficulty",
            constraint=models.CheckConstraint(
                condition=models.Q(level__gte=1, level__lte=5),
                name="study_sheet_difficulty_1_to_5",
            ),
        ),
    ]

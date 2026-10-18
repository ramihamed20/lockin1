from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("focus", "0019_active_study_pomodoro_style"),
    ]

    operations = [
        migrations.AddField(
            model_name="activestudyrun",
            name="pomodoro_clock",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]

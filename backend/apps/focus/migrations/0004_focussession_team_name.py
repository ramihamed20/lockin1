from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("focus", "0003_lock_in_mode")]

    operations = [
        migrations.AddField(
            model_name="focussession",
            name="team_name",
            field=models.CharField(blank=True, max_length=80),
        )
    ]

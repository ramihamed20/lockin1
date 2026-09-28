from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("content", "0010_activestudysettings_edition_catalogdocument_edition_and_more")]

    operations = [
        migrations.AddField(
            model_name="activestudysettings",
            name="questions_per_checkpoint",
            field=models.PositiveIntegerField(default=15),
        ),
        migrations.AddField(
            model_name="activestudysettings",
            name="final_exam_questions",
            field=models.PositiveIntegerField(default=50),
        ),
    ]

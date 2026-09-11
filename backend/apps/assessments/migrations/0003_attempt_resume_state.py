from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("assessments", "0002_alter_questionissuereport_category")]

    operations = [
        migrations.AddField(
            model_name="attempt",
            name="resume_client_revision",
            field=models.PositiveBigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="attempt",
            name="resume_question_position",
            field=models.PositiveSmallIntegerField(default=1),
        ),
    ]

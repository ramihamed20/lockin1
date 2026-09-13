from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("content", "0008_activestudyquestioncontent_source_version_and_more")]

    operations = [
        migrations.AlterField(
            model_name="learningobjectasset",
            name="role",
            field=models.CharField(
                choices=[
                    ("primary", "Primary file"),
                    ("summary", "Sheet summary PDF"),
                    ("transcript", "Transcript"),
                    ("caption", "Caption"),
                    ("cover", "Cover"),
                ],
                max_length=16,
            ),
        ),
    ]

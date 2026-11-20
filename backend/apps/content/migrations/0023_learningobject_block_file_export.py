from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("content", "0022_companion_card_types"),
    ]

    operations = [
        migrations.AddField(
            model_name="learningobject",
            name="block_file_export",
            field=models.BooleanField(default=False),
        ),
    ]

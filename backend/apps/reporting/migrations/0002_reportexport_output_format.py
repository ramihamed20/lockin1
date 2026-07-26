from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("reporting", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="reportexport",
            name="output_format",
            field=models.CharField(
                choices=[("csv", "CSV"), ("xlsx", "Excel workbook")],
                default="csv",
                max_length=8,
            ),
        )
    ]

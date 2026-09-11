from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("education", "0005_restore_legacy_dentistry_and_preparatory_cohorts")]

    operations = [
        migrations.AddField(
            model_name="studentcohort",
            name="content_nodes",
            field=models.ManyToManyField(
                blank=True,
                related_name="authorized_cohorts",
                to="education.educationnode",
            ),
        ),
    ]

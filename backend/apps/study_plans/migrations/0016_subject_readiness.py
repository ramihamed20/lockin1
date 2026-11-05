# Optional self-reported readiness for each catalog subject.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("study_plans", "0015_link_tripoli_carryover_midterms"),
    ]

    operations = [
        migrations.AddField(
            model_name="studyplanprofile",
            name="subject_readiness",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]

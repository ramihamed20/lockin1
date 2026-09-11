"""At most one ACTIVE run per user, sheet and difficulty.

This builds a partial unique index, so it FAILS CLOSED if the table already
holds duplicates. Run the detection query in docs/PRODUCTION_DATA_CHECKS.md
against production and resolve any rows it returns BEFORE applying this.

Legacy catalogue runs have ``sheet_id IS NULL`` and PostgreSQL treats NULLs as
distinct, so they are not covered and cannot block this migration.
"""

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('content', '0004_activestudyquestioncontent'),
        ('focus', '0007_managed_sheet_active_study'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='activestudyrun',
            constraint=models.UniqueConstraint(condition=models.Q(('status', 'active')), fields=('user', 'sheet', 'difficulty'), name='active_study_one_active_run_per_sheet'),
        ),
    ]

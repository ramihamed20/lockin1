from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('refunds', '0003_refundclaim'),
    ]

    operations = [
        migrations.AddField(
            model_name='refundclaim',
            name='transfer_details',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0011_user_visual_preferences'),
    ]

    operations = [
        migrations.AddField(
            model_name='accountdeletionrequest',
            name='processing_note',
            field=models.CharField(blank=True, max_length=1000),
        ),
        migrations.AddField(
            model_name='accountdeletionrequest',
            name='retained_until',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='accountdeletionrequest',
            name='retention_reason',
            field=models.CharField(blank=True, max_length=1000),
        ),
    ]

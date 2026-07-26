from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("audit", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="auditrecord",
            name="ip_address",
            field=models.GenericIPAddressField(blank=True, null=True),
        )
    ]

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("subscriptions", "0002_backfill_verified_trials")]

    operations = [
        migrations.AddField(
            model_name="subscription",
            name="last_payment_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="subscription",
            name="payment_verification",
            field=models.CharField(
                choices=[("verified", "Verified"), ("provisional", "Payment review pending")],
                default="verified",
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="subscription",
            name="provisional_payment_id",
            field=models.UUIDField(blank=True, null=True),
        ),
    ]

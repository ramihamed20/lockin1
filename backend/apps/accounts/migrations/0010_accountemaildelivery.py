import uuid

from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [("accounts", "0009_account_deletion_request")]
    operations = [migrations.CreateModel(
        name="AccountEmailDelivery",
        fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("recipient", models.EmailField(max_length=254)), ("subject", models.CharField(max_length=200)),
            ("encrypted_body", models.TextField()),
            ("status", models.CharField(choices=[("pending", "Pending"), ("sending", "Sending"), ("sent", "Sent"), ("failed", "Failed")], db_index=True, default="pending", max_length=12)),
            ("attempts", models.PositiveSmallIntegerField(default=0)),
            ("next_attempt_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
            ("sent_at", models.DateTimeField(blank=True, null=True)), ("failed_at", models.DateTimeField(blank=True, null=True)),
            ("last_error", models.CharField(blank=True, max_length=240)), ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("token", models.OneToOneField(on_delete=models.deletion.CASCADE, related_name="email_delivery", to="accounts.onetimetoken")),
        ], options={"indexes": [models.Index(fields=["status", "next_attempt_at"], name="accounts_email_due_idx")]},
    )]

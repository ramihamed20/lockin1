import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("admin_control", "0001_initial"),
        ("payments", "0002_payment_currency_exponent_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="PaymentStatusCorrection",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("requested_status", models.CharField(max_length=24)),
                ("provider_reference", models.CharField(max_length=180)),
                ("reason", models.CharField(max_length=500)),
                ("review_reason", models.CharField(blank=True, max_length=500)),
                ("status", models.CharField(choices=[("pending", "Pending review"), ("approved", "Approved"), ("rejected", "Rejected")], default="pending", max_length=12)),
                ("idempotency_key", models.CharField(max_length=180)),
                ("approval_idempotency_key", models.CharField(blank=True, max_length=180)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("payment", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="admin_corrections", to="payments.payment")),
                ("requested_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="payment_corrections_requested", to=settings.AUTH_USER_MODEL)),
                ("reviewed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="payment_corrections_reviewed", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-created_at", "-id")},
        ),
        migrations.AddConstraint(
            model_name="paymentstatuscorrection",
            constraint=models.UniqueConstraint(fields=("payment", "requested_by", "idempotency_key"), name="admin_payment_correction_idempotent"),
        ),
        migrations.AddIndex(model_name="paymentstatuscorrection", index=models.Index(fields=("payment", "status", "-created_at"), name="admin_payment_correct_idx")),
        migrations.AddIndex(model_name="paymentstatuscorrection", index=models.Index(fields=("status", "-created_at"), name="admin_correction_state_idx")),
    ]

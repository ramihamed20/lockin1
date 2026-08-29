import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0007_username_and_welcome_state"),
        ("payments", "0002_payment_currency_exponent_and_more"),
        ("subscriptions", "0003_payment_verification_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="method",
            field=models.CharField(
                choices=[("provider", "Online provider"), ("libyana", "Libyana recharge card")],
                default="provider",
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="paymenttransition",
            name="source",
            field=models.CharField(
                choices=[
                    ("system", "System"),
                    ("provider", "Verified provider event"),
                    ("manual_review", "Manual payment review"),
                    ("refund", "Refund"),
                    ("reconciliation", "Reconciliation"),
                ],
                max_length=16,
            ),
        ),
        migrations.CreateModel(
            name="ManualRechargeSubmission",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("recharge_code_ciphertext", models.TextField()),
                (
                    "recharge_code_digest",
                    models.CharField(editable=False, max_length=64, unique=True),
                ),
                ("recharge_code_last4", models.CharField(editable=False, max_length=4)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending review"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("cancelled", "Cancelled"),
                        ],
                        default="pending",
                        max_length=12,
                    ),
                ),
                (
                    "submitted_at",
                    models.DateTimeField(db_index=True, default=timezone.now),
                ),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("rejection_reason", models.CharField(blank=True, max_length=500)),
                ("subscription_period_started_at", models.DateTimeField()),
                ("subscription_period_ends_at", models.DateTimeField()),
                ("previous_subscription_state", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "payment",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="manual_submission",
                        to="payments.payment",
                    ),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="manual_payments_reviewed",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="manual_payment_submissions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ("-submitted_at", "-id")},
        ),
        migrations.AddConstraint(
            model_name="manualrechargesubmission",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status", "pending")),
                fields=("user",),
                name="manual_payment_one_pending_per_user",
            ),
        ),
        migrations.AddConstraint(
            model_name="manualrechargesubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("subscription_period_ends_at__gt", models.F("subscription_period_started_at"))
                ),
                name="manual_payment_period_valid",
            ),
        ),
        migrations.AddIndex(
            model_name="manualrechargesubmission",
            index=models.Index(fields=["status", "submitted_at"], name="manual_payment_review_idx"),
        ),
        migrations.AddIndex(
            model_name="manualrechargesubmission",
            index=models.Index(fields=["user", "-submitted_at"], name="manual_payment_user_idx"),
        ),
    ]

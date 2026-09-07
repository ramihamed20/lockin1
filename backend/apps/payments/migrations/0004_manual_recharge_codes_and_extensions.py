import uuid

import django.db.models.deletion
from django.db import migrations, models


def backfill_first_recharge_codes(apps, schema_editor):  # type: ignore[no-untyped-def]
    Submission = apps.get_model("payments", "ManualRechargeSubmission")
    RechargeCode = apps.get_model("payments", "ManualRechargeCode")
    for submission in Submission.objects.exclude(recharge_code_digest="").iterator():
        RechargeCode.objects.get_or_create(
            digest=submission.recharge_code_digest,
            defaults={
                "submission_id": submission.id,
                "position": 1,
                "ciphertext": submission.recharge_code_ciphertext,
                "last4": submission.recharge_code_last4,
            },
        )


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0003_manual_libyana_submission"),
        ("product_catalog", "0005_libyana_subscription_offers"),
    ]

    operations = [
        migrations.AddField(
            model_name="manualrechargesubmission",
            name="extension_ends_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="manualrechargesubmission",
            name="extension_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="manualrechargesubmission",
            name="is_early_renewal",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="manualrechargesubmission",
            name="previous_subscription_end_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="ManualRechargeCode",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("position", models.PositiveSmallIntegerField()),
                ("ciphertext", models.TextField()),
                ("digest", models.CharField(editable=False, max_length=64, unique=True)),
                ("last4", models.CharField(editable=False, max_length=4)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "submission",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="recharge_codes",
                        to="payments.manualrechargesubmission",
                    ),
                ),
            ],
            options={"ordering": ("position", "id")},
        ),
        migrations.AddConstraint(
            model_name="manualrechargecode",
            constraint=models.UniqueConstraint(
                fields=("submission", "position"), name="manual_recharge_code_position_unique"
            ),
        ),
        migrations.AddIndex(
            model_name="manualrechargecode",
            index=models.Index(
                fields=("submission", "position"), name="manual_recharge_code_order_idx"
            ),
        ),
        migrations.RunPython(backfill_first_recharge_codes, migrations.RunPython.noop),
    ]

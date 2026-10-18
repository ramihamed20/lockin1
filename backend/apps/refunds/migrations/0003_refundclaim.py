import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0008_installment_agreements'),
        ('refunds', '0002_refund_currency_exponent_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='RefundClaim',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('kind', models.CharField(choices=[('voluntary', 'Change of mind'), ('platform_error', 'Platform error or unavailable service'), ('payment_error', 'Invalid, partial or duplicate payment'), ('termination', 'End installment agreement')], max_length=24)),
                ('remedy', models.CharField(default='refund', max_length=12)),
                ('reason', models.CharField(max_length=1000)),
                ('receiver_phone', models.CharField(blank=True, max_length=20)),
                ('status', models.CharField(choices=[('requested', 'Awaiting review'), ('needs_info', 'More information needed'), ('approved', 'Approved for transfer'), ('completed', 'Transfer recorded'), ('rejected', 'Rejected with reason'), ('compensating', 'Free access until restoration'), ('resolved', 'Service restored')], default='requested', max_length=16)),
                ('received_at', models.DateTimeField()),
                ('due_at', models.DateTimeField(db_index=True)),
                ('channel', models.CharField(default='website', max_length=12)),
                ('idempotency_key', models.CharField(max_length=180)),
                ('policy_version', models.CharField(blank=True, max_length=64)),
                ('quoted_amount_minor', models.PositiveBigIntegerField(default=0)),
                ('approved_amount_minor', models.PositiveBigIntegerField(blank=True, null=True)),
                ('allocations', models.JSONField(default=list)),
                ('decision_reason', models.CharField(blank=True, max_length=1000)),
                ('transfer_reference', models.CharField(blank=True, max_length=160)),
                ('reviewed_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('payment', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='claims', to='payments.payment')),
                ('reviewed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='reviewed_refund_claims', to=settings.AUTH_USER_MODEL)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='refund_claims', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ('received_at', 'id'),
                'constraints': [models.UniqueConstraint(fields=('user', 'idempotency_key'), name='refund_claim_retry'), models.UniqueConstraint(condition=models.Q(('status__in', ('requested', 'needs_info', 'approved', 'compensating'))), fields=('payment',), name='refund_claim_one_open')],
            },
        ),
    ]

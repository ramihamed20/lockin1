"""Recharge-card digests become indexed instead of globally unique.

Dropping a unique index never conflicts with existing data, so this migration
needs no pre-flight check and is safe to re-run order-wise. It only widens what
the schema permits: the same card number may now appear on more than one
submission, which is what lets a genuine second manual attempt reach a reviewer.

Duplicate protection that remains: one pending submission per user
(``manual_payment_one_pending_per_user``) and one payment per
(account, idempotency_key) (``payment_account_idempotent``).
"""

from django.db import migrations, models
from django.db.migrations.exceptions import IrreversibleError


def prohibit_reverse(apps, schema_editor):
    """Do not recreate a uniqueness guarantee legitimate data may violate.

    Once a card digest has appeared in more than one manual attempt, restoring
    the old unique indexes would either fail or require deleting billing
    evidence.  Neither is a safe schema rollback, so this migration is
    intentionally irreversible.
    """

    raise IrreversibleError(
        "payments.0005 cannot be reversed after duplicate recharge digests may exist; "
        "restoring uniqueness would require deleting legitimate payment evidence."
    )


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0004_manual_recharge_codes_and_extensions'),
    ]

    operations = [
        migrations.AlterField(
            model_name='manualrechargecode',
            name='digest',
            field=models.CharField(db_index=True, editable=False, max_length=64),
        ),
        migrations.AlterField(
            model_name='manualrechargesubmission',
            name='recharge_code_digest',
            field=models.CharField(db_index=True, editable=False, max_length=64),
        ),
        # Put this last so reverse migration stops before Django attempts to
        # recreate either unique index.
        migrations.RunPython(migrations.RunPython.noop, prohibit_reverse),
    ]

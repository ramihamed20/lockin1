from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0003_seed_account_role_groups"),
    ]

    operations = [
        migrations.RenameModel(
            old_name="LoginAttempt",
            new_name="AuthAttempt",
        ),
        migrations.AddField(
            model_name="authattempt",
            name="scope",
            field=models.CharField(default="login", max_length=32),
            preserve_default=False,
        ),
        migrations.RemoveIndex(
            model_name="authattempt",
            name="accounts_lo_key_has_320a2e_idx",
        ),
        migrations.AddIndex(
            model_name="authattempt",
            index=models.Index(
                fields=["scope", "key_hash", "attempted_at"],
                name="accounts_au_scope_09c289_idx",
            ),
        ),
    ]

import re

import django.core.validators
from django.db import migrations, models
from django.db.models.functions import Lower


def preserve_existing_account_onboarding(apps, schema_editor):  # type: ignore[no-untyped-def]
    User = apps.get_model("accounts", "User")
    used: set[str] = set()
    for user in User.objects.order_by("date_joined", "id").iterator(chunk_size=500):
        local = user.email.split("@", 1)[0].lower()
        base = re.sub(r"[^a-z0-9]", "", local)[:20]
        if len(base) < 3:
            base = "student"
        candidate = base
        suffix = str(user.id).replace("-", "")[:6]
        sequence = 0
        while candidate.lower() in used:
            sequence += 1
            candidate = f"{base[:20]}_{suffix}{sequence if sequence > 1 else ''}"[:30]
        used.add(candidate.lower())
        User.objects.filter(id=user.id).update(
            username=candidate,
            # Existing accounts retain their established experience. Only accounts
            # created after this migration see the new one-time welcome screen.
            welcome_completed_at=user.date_joined,
        )


class Migration(migrations.Migration):
    dependencies = [("accounts", "0006_social_auth_and_cohort")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="username",
            field=models.CharField(
                blank=True,
                max_length=30,
                null=True,
                validators=[
                    django.core.validators.RegexValidator(
                        message=(
                            "Use 3–30 lowercase letters, numbers, or underscores, "
                            "starting with a letter or number."
                        ),
                        regex="^[a-z0-9][a-z0-9_]{2,29}$",
                    )
                ],
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="welcome_completed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(preserve_existing_account_onboarding, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="user",
            constraint=models.UniqueConstraint(
                Lower("username"),
                condition=models.Q(username__isnull=False),
                name="accounts_user_username_ci_unique",
            ),
        ),
    ]

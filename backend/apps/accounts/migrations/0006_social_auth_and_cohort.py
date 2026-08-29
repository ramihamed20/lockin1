import uuid

import django.db.models.deletion
from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0005_alter_accountsecurityevent_event_type"),
        ("education", "0003_academic_programs_and_cohorts"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="cohort",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="students",
                to="education.studentcohort",
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="profile_completion_required",
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name="user",
            name="full_name",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AlterField(
            model_name="accountsecurityevent",
            name="event_type",
            field=models.CharField(
                choices=[
                    ("registered", "Registered"),
                    ("email_verified", "Email verified"),
                    ("email_changed", "Email changed"),
                    ("password_changed", "Password changed"),
                    ("password_reset", "Password reset"),
                    ("login_succeeded", "Login succeeded"),
                    ("social_identity_linked", "Social identity linked"),
                    ("social_login_succeeded", "Social login succeeded"),
                    ("logout", "Logout"),
                    ("role_changed", "Role changed"),
                    ("status_changed", "Status changed"),
                ],
                max_length=24,
            ),
        ),
        migrations.CreateModel(
            name="OAuthFlow",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "provider",
                    models.CharField(
                        choices=[("google", "Google"), ("apple", "Apple")],
                        max_length=16,
                    ),
                ),
                (
                    "intent",
                    models.CharField(
                        choices=[("login", "Login"), ("register", "Register")],
                        max_length=16,
                    ),
                ),
                ("state_digest", models.CharField(editable=False, max_length=64)),
                ("nonce_digest", models.CharField(editable=False, max_length=64)),
                (
                    "browser_binding_digest",
                    models.CharField(editable=False, max_length=64),
                ),
                (
                    "preferred_language",
                    models.CharField(
                        choices=[("en", "English"), ("ar", "Arabic")],
                        default="en",
                        max_length=2,
                    ),
                ),
                ("remember_me", models.BooleanField(default=True)),
                ("policy_accepted", models.BooleanField(default=False)),
                ("policy_version", models.CharField(blank=True, max_length=64)),
                ("expires_at", models.DateTimeField(db_index=True)),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.AddIndex(
            model_name="oauthflow",
            index=models.Index(
                fields=["provider", "expires_at", "used_at"],
                name="accounts_oauth_flow_idx",
            ),
        ),
        migrations.CreateModel(
            name="SocialIdentity",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "provider",
                    models.CharField(
                        choices=[("google", "Google"), ("apple", "Apple")],
                        max_length=16,
                    ),
                ),
                ("subject", models.CharField(max_length=255)),
                ("provider_email", models.EmailField(blank=True, max_length=254)),
                ("email_verified", models.BooleanField(default=False)),
                ("is_private_relay", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("last_used_at", models.DateTimeField(default=django.utils.timezone.now)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="social_identities",
                        to="accounts.user",
                    ),
                ),
            ],
            options={
                "ordering": ("provider", "created_at"),
                "constraints": [
                    models.UniqueConstraint(
                        fields=("provider", "subject"),
                        name="accounts_social_provider_subject_unique",
                    ),
                    models.UniqueConstraint(
                        fields=("user", "provider"),
                        name="accounts_social_user_provider_unique",
                    ),
                ],
            },
        ),
    ]

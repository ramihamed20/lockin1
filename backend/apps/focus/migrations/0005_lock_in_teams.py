import uuid

import apps.focus.models
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("focus", "0004_focussession_team_name"),
    ]

    operations = [
        migrations.CreateModel(
            name="FocusTeam",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=80)),
                ("invite_code", models.CharField(db_index=True, default=apps.focus.models.focus_team_invite_code, max_length=12, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="owned_focus_teams", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("-updated_at", "name")},
        ),
        migrations.CreateModel(
            name="FocusTeamMessage",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("body", models.CharField(max_length=1000)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("author", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="focus_team_messages", to=settings.AUTH_USER_MODEL)),
                ("team", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="messages", to="focus.focusteam")),
            ],
            options={"ordering": ("created_at", "id")},
        ),
        migrations.CreateModel(
            name="FocusTeamMembership",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("role", models.CharField(choices=[("owner", "Owner"), ("member", "Member")], default="member", max_length=12)),
                ("joined_at", models.DateTimeField(auto_now_add=True)),
                ("team", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to="focus.focusteam")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="focus_team_memberships", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("joined_at", "id")},
        ),
        migrations.AddField(
            model_name="focussession",
            name="team",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="sessions", to="focus.focusteam"),
        ),
        migrations.AddIndex(
            model_name="focusteammessage",
            index=models.Index(fields=["team", "-created_at"], name="focus_team_message_idx"),
        ),
        migrations.AddConstraint(
            model_name="focusteammembership",
            constraint=models.UniqueConstraint(fields=("team", "user"), name="focus_team_member_unique"),
        ),
    ]

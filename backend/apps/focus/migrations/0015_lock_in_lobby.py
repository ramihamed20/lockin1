import secrets

import apps.focus.models
from django.db import migrations, models
from django.db.models import Count


def numeric_team_codes(apps, schema_editor):
    Team = apps.get_model("focus", "FocusTeam")
    Membership = apps.get_model("focus", "FocusTeamMembership")
    used = set(Team.objects.values_list("invite_code", flat=True))
    for team in Team.objects.exclude(invite_code__regex=r"^[0-9]{6}$").iterator():
        for _ in range(100):
            code = f"{secrets.randbelow(900_000) + 100_000:06d}"
            if code not in used:
                Team.objects.filter(pk=team.pk).update(invite_code=code)
                used.add(code)
                break
        else:
            raise RuntimeError("Could not allocate a six-digit team code")
    for row in Membership.objects.values("team_id").annotate(total=Count("id")):
        if row["total"] > 8:
            Team.objects.filter(pk=row["team_id"]).update(max_members=row["total"])


class Migration(migrations.Migration):
    dependencies = [("focus", "0014_lofi_scenes")]

    operations = [
        migrations.AddField(
            model_name="focusteam", name="max_members",
            field=models.PositiveSmallIntegerField(default=8),
        ),
        migrations.AddField(
            model_name="focussession", name="anonymous",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="focusteam", name="joining_locked",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="focusteam", name="closed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="focusteammembership", name="anonymous",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="focusteammembership", name="anonymous_alias",
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.AddField(
            model_name="focusteammessage", name="author_alias",
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.AddField(
            model_name="focusteammessage", name="author_membership_id",
            field=models.UUIDField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="focusteam", name="invite_code",
            field=models.CharField(
                db_index=True, default=apps.focus.models.focus_team_invite_code,
                max_length=12, unique=True,
            ),
        ),
        migrations.RunPython(numeric_team_codes, migrations.RunPython.noop),
    ]

from django.db import migrations


MANAGED_ROLE_NAMES = ("moderator", "creator", "administrator")


def create_managed_role_groups(apps, schema_editor):
    group_model = apps.get_model("auth", "Group")
    for role_name in MANAGED_ROLE_NAMES:
        group_model.objects.get_or_create(name=role_name)


def remove_managed_role_groups(apps, schema_editor):
    group_model = apps.get_model("auth", "Group")
    group_model.objects.filter(name__in=MANAGED_ROLE_NAMES).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_accountsecurityevent_accountsession_loginattempt_and_more"),
    ]

    operations = [
        migrations.RunPython(create_managed_role_groups, remove_managed_role_groups),
    ]

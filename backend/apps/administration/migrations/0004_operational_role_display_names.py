from django.db import migrations


def update_role_names(apps, schema_editor):  # type: ignore[no-untyped-def]
    role_model = apps.get_model("administration", "OperationalRole")
    for code, name in {
        "platform_administrator": "Super Admin",
        "content_manager": "Content Admin",
        "finance": "Finance Admin",
    }.items():
        role_model.objects.filter(code=code).update(name=name)


class Migration(migrations.Migration):
    dependencies = [("administration", "0003_operationalcapabilityassignment")]

    operations = [migrations.RunPython(update_role_names, migrations.RunPython.noop)]

from django.db import migrations


def seed_configuration(apps, schema_editor):  # type: ignore[no-untyped-def]
    model = apps.get_model("system_configuration", "ConfigurationEntry")
    for key, value in (
        ("analytics.default_window_days", 14),
        ("reporting.max_export_rows", 5000),
        ("operations.max_action_targets", 100),
        ("operations.preview_ttl_seconds", 900),
    ):
        model.objects.get_or_create(key=key, defaults={"value_type": "integer", "value": value})


class Migration(migrations.Migration):
    dependencies = [("system_configuration", "0001_initial")]
    operations = [migrations.RunPython(seed_configuration, migrations.RunPython.noop)]

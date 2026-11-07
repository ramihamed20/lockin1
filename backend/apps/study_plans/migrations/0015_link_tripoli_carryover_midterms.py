"""Explicitly link Second Year to First Year midterms of the same academic year."""

from uuid import NAMESPACE_URL, uuid5

from django.db import migrations


def link_periods(apps, schema_editor):  # type: ignore[no-untyped-def]
    Period = apps.get_model("study_plans", "ExamPeriod")
    first = uuid5(NAMESPACE_URL, "lockin:dentistry-tripoli:year-1:midterm:2026-2027")
    second = uuid5(NAMESPACE_URL, "lockin:dentistry-tripoli:year-2:midterm:2026-2027")
    source = Period.objects.using(schema_editor.connection.alias).get(pk=first)
    target = Period.objects.using(schema_editor.connection.alias).get(pk=second)
    target.carryover_period_id = source.pk
    target.save(update_fields=["carryover_period"])


class Migration(migrations.Migration):
    dependencies = [("study_plans", "0014_carryover_exam_period")]

    operations = [migrations.RunPython(link_periods, migrations.RunPython.noop)]

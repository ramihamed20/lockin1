"""Correct the Removable Prosthodontic subject slug.

``0007`` seeded the subject from the title "Removeable prosthodontic", which
slugified to ``removeable-prosthodontic``. Everything that addresses the subject
by name outside the hierarchy -- the frontend catalogue, the Questions routes,
``content.0006``'s display-name map -- spells it ``removable``. One of the two
had to move, and the misspelling is the one that is wrong in English.

The route key derived from this slug is rewritten alongside it in
``content.0010`` so a student's Materials link and their saved workspace state
land on the same branch afterwards.
"""

from django.db import migrations

OLD_SLUG = "removeable-prosthodontic"
NEW_SLUG = "removable-prosthodontic"
NEW_TITLE = "Removable Prosthodontic"


def rename(apps, schema_editor):  # type: ignore[no-untyped-def]
    EducationNode = apps.get_model("education", "EducationNode")
    EducationNode.objects.filter(kind="subject", slug=OLD_SLUG).update(
        slug=NEW_SLUG, title=NEW_TITLE
    )


def restore(apps, schema_editor):  # type: ignore[no-untyped-def]
    EducationNode = apps.get_model("education", "EducationNode")
    EducationNode.objects.filter(kind="subject", slug=NEW_SLUG).update(
        slug=OLD_SLUG, title="Removeable prosthodontic"
    )


class Migration(migrations.Migration):
    dependencies = [("education", "0008_repair_dentistry_cohort_labels")]

    operations = [migrations.RunPython(rename, restore)]

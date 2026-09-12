"""Re-run the Catalog branch projection, and carry the corrected slug through.

``0006`` projected the hierarchy exactly once. Every subject, year or cohort
content root configured afterwards has had no branch since, and a subject with
no branch is invisible to students regardless of how much content it holds.
``apps.content.signals`` keeps this current from now on; this migration is the
one-off reconciliation for databases that predate it.

It also rewrites the Removable Prosthodontic route key to match the slug
corrected in ``education.0009``. ``CatalogDocument.material_slug`` is rewritten
in the same transaction: it is a denormalised copy of the branch's key, so a
rename that missed it would leave every published sheet on that subject
unreachable.

This deliberately mirrors the service rather than importing it. A migration has
to keep working against the models as they were at this point in history, which
is exactly what a later refactor of the service is free to change.
"""

from django.db import migrations

OLD_SUFFIX = "-removeable-prosthodontic"
NEW_SUFFIX = "-removable-prosthodontic"

TITLE_OVERRIDES = {
    "general-pathology": "General Pathology",
    "oral-histology": "Oral Histology",
    "fixed-prosthodontic": "Fixed Prosthodontic",
    "removable-prosthodontic": "Removable Prosthodontic",
}


def _rename_removable(apps):  # type: ignore[no-untyped-def]
    CatalogSubject = apps.get_model("content", "CatalogSubject")
    CatalogDocument = apps.get_model("content", "CatalogDocument")
    for subject in CatalogSubject.objects.filter(slug="removeable-prosthodontic"):
        old_material_slug = subject.material_slug
        new_material_slug = (
            old_material_slug[: -len(OLD_SUFFIX)] + NEW_SUFFIX
            if old_material_slug.endswith(OLD_SUFFIX)
            else old_material_slug
        )
        if CatalogSubject.objects.filter(material_slug=new_material_slug).exclude(
            id=subject.id
        ).exists():
            # A correctly spelled branch already exists for this cohort. Leave
            # both alone rather than merging two branches inside a migration.
            continue
        subject.slug = "removable-prosthodontic"
        subject.title = TITLE_OVERRIDES["removable-prosthodontic"]
        subject.material_slug = new_material_slug
        subject.save()
        if new_material_slug != old_material_slug:
            CatalogDocument.objects.filter(material_slug=old_material_slug).update(
                material_slug=new_material_slug
            )


def _project(apps):  # type: ignore[no-untyped-def]
    CatalogSubject = apps.get_model("content", "CatalogSubject")
    StudentCohort = apps.get_model("education", "StudentCohort")
    EducationNode = apps.get_model("education", "EducationNode")

    owned: set = set(CatalogSubject.objects.values_list("source_node_id", flat=True))
    cohorts = (
        StudentCohort.objects.filter(is_active=True)
        .select_related("program")
        .prefetch_related("content_nodes")
        .order_by("program__position", "position", "id")
    )
    for cohort in cohorts:
        for root in cohort.content_nodes.all():
            subjects = EducationNode.objects.filter(
                kind="subject", path__startswith=root.path
            ).order_by("position", "title", "id")
            for node in subjects:
                if node.id in owned:
                    continue
                material_slug = f"{cohort.program.code}-{cohort.code}-{node.slug}"[:240]
                if CatalogSubject.objects.filter(material_slug=material_slug).exists():
                    continue
                adopted = CatalogSubject.objects.filter(
                    cohort_id=cohort.id, slug=node.slug, source_node__isnull=True
                ).first()
                if adopted is not None:
                    adopted.source_node_id = node.id
                    adopted.save()
                    owned.add(node.id)
                    continue
                CatalogSubject.objects.create(
                    cohort_id=cohort.id,
                    source_node_id=node.id,
                    title=TITLE_OVERRIDES.get(node.slug, node.title),
                    slug=node.slug,
                    material_slug=material_slug,
                    position=node.position,
                    is_active=True,
                )
                owned.add(node.id)


def backfill(apps, schema_editor):  # type: ignore[no-untyped-def]
    _rename_removable(apps)
    _project(apps)


class Migration(migrations.Migration):
    dependencies = [
        ("content", "0006_catalogsubject"),
        ("education", "0009_rename_removable_prosthodontic_slug"),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]

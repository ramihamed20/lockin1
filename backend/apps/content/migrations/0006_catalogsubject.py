import uuid

import django.db.models.deletion
from django.db import migrations, models


def seed_catalog_subjects(apps, schema_editor):  # type: ignore[no-untyped-def]
    CatalogSubject = apps.get_model("content", "CatalogSubject")
    StudentCohort = apps.get_model("education", "StudentCohort")
    EducationNode = apps.get_model("education", "EducationNode")
    labels = {
        "general-pathology": "General Pathology",
        "oral-histology": "Oral Histology",
        "fixed-prosthodontic": "Fixed Prosthodontic",
        "removeable-prosthodontic": "Removable Prosthodontic",
    }
    for cohort in (
        StudentCohort.objects.select_related("program").prefetch_related("content_nodes").all()
    ):
        for root in cohort.content_nodes.all():
            for subject in EducationNode.objects.filter(parent_id=root.id, kind="subject").order_by(
                "position", "id"
            ):
                CatalogSubject.objects.update_or_create(
                    cohort_id=cohort.id,
                    slug=subject.slug,
                    defaults={
                        "source_node_id": subject.id,
                        "title": labels.get(subject.slug, subject.title),
                        "material_slug": f"{cohort.program.code}-{cohort.code}-{subject.slug}",
                        "position": subject.position,
                        "is_active": True,
                    },
                )


class Migration(migrations.Migration):
    dependencies = [
        ("content", "0005_catalogdocument_catalogworkspacesnapshot_and_more"),
        ("education", "0007_seed_libyan_education_tree"),
    ]

    operations = [
        migrations.CreateModel(
            name="CatalogSubject",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("title", models.CharField(max_length=180)),
                ("slug", models.SlugField(max_length=180)),
                ("material_slug", models.SlugField(max_length=240, unique=True)),
                ("position", models.PositiveIntegerField(default=0)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "cohort",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="catalog_subjects",
                        to="education.studentcohort",
                    ),
                ),
                (
                    "source_node",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="catalog_subject",
                        to="education.educationnode",
                    ),
                ),
            ],
            options={"ordering": ("cohort__position", "position", "title", "id")},
        ),
        migrations.AddConstraint(
            model_name="catalogsubject",
            constraint=models.UniqueConstraint(
                fields=("cohort", "slug"), name="catalog_subject_cohort_slug_unique"
            ),
        ),
        migrations.RunPython(seed_catalog_subjects, migrations.RunPython.noop),
    ]

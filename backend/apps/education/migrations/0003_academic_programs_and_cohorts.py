import uuid

import django.db.models.deletion
from django.db import migrations, models


PROGRAM_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329f001")
COHORT_61_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329f061")
COHORT_60_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329f060")


def seed_initial_cohorts(apps, schema_editor):  # type: ignore[no-untyped-def]
    AcademicProgram = apps.get_model("education", "AcademicProgram")
    StudentCohort = apps.get_model("education", "StudentCohort")
    program, _ = AcademicProgram.objects.update_or_create(
        id=PROGRAM_ID,
        defaults={
            "code": "human-medicine",
            "name_en": "Human Medicine",
            "name_ar": "الطب البشري",
            "is_active": True,
            "position": 1,
        },
    )
    for cohort_id, code, name_en, name_ar, position in (
        (COHORT_61_ID, "61", "Human Medicine 61", "الطب البشري 61", 1),
        (COHORT_60_ID, "60", "Human Medicine 60", "الطب البشري 60", 2),
    ):
        StudentCohort.objects.update_or_create(
            id=cohort_id,
            defaults={
                "program": program,
                "code": code,
                "name_en": name_en,
                "name_ar": name_ar,
                "is_active": True,
                "position": position,
            },
        )


def remove_initial_cohorts(apps, schema_editor):  # type: ignore[no-untyped-def]
    StudentCohort = apps.get_model("education", "StudentCohort")
    AcademicProgram = apps.get_model("education", "AcademicProgram")
    StudentCohort.objects.filter(id__in=(COHORT_61_ID, COHORT_60_ID)).delete()
    AcademicProgram.objects.filter(id=PROGRAM_ID).delete()


class Migration(migrations.Migration):
    dependencies = [("education", "0002_remove_creatorscope_edu_scope_has_capability_and_more")]

    operations = [
        migrations.CreateModel(
            name="AcademicProgram",
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
                ("code", models.SlugField(max_length=80, unique=True)),
                ("name_en", models.CharField(max_length=120)),
                ("name_ar", models.CharField(max_length=120)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("position", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ("position", "name_en", "id")},
        ),
        migrations.CreateModel(
            name="StudentCohort",
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
                ("code", models.SlugField(max_length=80)),
                ("name_en", models.CharField(max_length=120)),
                ("name_ar", models.CharField(max_length=120)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("position", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "program",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="cohorts",
                        to="education.academicprogram",
                    ),
                ),
            ],
            options={
                "ordering": ("program__position", "position", "name_en", "id"),
                "constraints": [
                    models.UniqueConstraint(
                        fields=("program", "code"),
                        name="education_program_cohort_unique",
                    )
                ],
            },
        ),
        migrations.RunPython(seed_initial_cohorts, remove_initial_cohorts),
    ]

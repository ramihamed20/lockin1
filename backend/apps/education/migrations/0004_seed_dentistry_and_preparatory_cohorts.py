import uuid

from django.db import migrations


DENTISTRY_PROGRAM_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329f002")
DENTISTRY_COHORT_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329d001")
PREPARATORY_PROGRAM_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329f003")
PREPARATORY_COHORT_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329c003")


def seed_additional_study_paths(apps, schema_editor):  # type: ignore[no-untyped-def]
    AcademicProgram = apps.get_model("education", "AcademicProgram")
    StudentCohort = apps.get_model("education", "StudentCohort")

    for program_id, cohort_id, program, cohort in (
        (
            DENTISTRY_PROGRAM_ID,
            DENTISTRY_COHORT_ID,
            {
                "code": "dentistry",
                "name_en": "Dentistry",
                "name_ar": "طب الأسنان",
                "position": 2,
            },
            {
                "code": "dentistry",
                "name_en": "Dentistry",
                "name_ar": "طب الأسنان",
                "position": 1,
            },
        ),
        (
            PREPARATORY_PROGRAM_ID,
            PREPARATORY_COHORT_ID,
            {
                "code": "preparatory",
                "name_en": "Preparatory",
                "name_ar": "تمهيدي",
                "position": 3,
            },
            {
                "code": "preparatory",
                "name_en": "Preparatory",
                "name_ar": "تمهيدي",
                "position": 1,
            },
        ),
    ):
        program_record, _ = AcademicProgram.objects.update_or_create(
            id=program_id,
            defaults={**program, "is_active": True},
        )
        StudentCohort.objects.update_or_create(
            id=cohort_id,
            defaults={"program": program_record, **cohort, "is_active": True},
        )


def remove_additional_study_paths(apps, schema_editor):  # type: ignore[no-untyped-def]
    AcademicProgram = apps.get_model("education", "AcademicProgram")
    StudentCohort = apps.get_model("education", "StudentCohort")
    StudentCohort.objects.filter(id__in=(DENTISTRY_COHORT_ID, PREPARATORY_COHORT_ID)).delete()
    AcademicProgram.objects.filter(id__in=(DENTISTRY_PROGRAM_ID, PREPARATORY_PROGRAM_ID)).delete()


class Migration(migrations.Migration):
    dependencies = [("education", "0003_academic_programs_and_cohorts")]

    operations = [migrations.RunPython(seed_additional_study_paths, remove_additional_study_paths)]

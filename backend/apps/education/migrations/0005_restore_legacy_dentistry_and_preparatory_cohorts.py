import uuid

from django.db import migrations


TRIPOLI_DENTISTRY_PROGRAM_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329f002")
TRIPOLI_DENTISTRY_YEAR_2_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329d001")
TRIPOLI_DENTISTRY_YEAR_1_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329d002")
ZAWIYA_DENTISTRY_PROGRAM_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329f004")
ZAWIYA_DENTISTRY_YEAR_2_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329d003")
BENGHAZI_DENTISTRY_PROGRAM_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329f005")
BENGHAZI_DENTISTRY_YEAR_2_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329d004")
TRIPOLI_MEDICAL_SCIENCES_PROGRAM_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329f003")
TRIPOLI_PREPARATORY_ID = uuid.UUID("a19b3034-e038-46b8-8806-7b113329c003")


def seed_legacy_study_paths(apps, schema_editor):  # type: ignore[no-untyped-def]
    AcademicProgram = apps.get_model("education", "AcademicProgram")
    StudentCohort = apps.get_model("education", "StudentCohort")

    tripoli_dentistry, _ = AcademicProgram.objects.update_or_create(
        id=TRIPOLI_DENTISTRY_PROGRAM_ID,
        defaults={
            "code": "dentistry-tripoli",
            "name_en": "Dentistry — Tripoli",
            "name_ar": "طب الأسنان طرابلس",
            "is_active": True,
            "position": 2,
        },
    )
    zawiya_dentistry, _ = AcademicProgram.objects.update_or_create(
        id=ZAWIYA_DENTISTRY_PROGRAM_ID,
        defaults={
            "code": "dentistry-zawiya",
            "name_en": "Dentistry — Zawiya",
            "name_ar": "طب الأسنان زاوية",
            "is_active": True,
            "position": 3,
        },
    )
    benghazi_dentistry, _ = AcademicProgram.objects.update_or_create(
        id=BENGHAZI_DENTISTRY_PROGRAM_ID,
        defaults={
            "code": "dentistry-benghazi",
            "name_en": "Dentistry — Benghazi",
            "name_ar": "طب الأسنان بنغازي",
            "is_active": True,
            "position": 4,
        },
    )
    tripoli_medical_sciences, _ = AcademicProgram.objects.update_or_create(
        id=TRIPOLI_MEDICAL_SCIENCES_PROGRAM_ID,
        defaults={
            "code": "medical-sciences-tripoli",
            "name_en": "Medical Sciences — Tripoli",
            "name_ar": "علوم طبية طرابلس",
            "is_active": True,
            "position": 5,
        },
    )

    for cohort_id, program, code, name_en, name_ar, position in (
        (TRIPOLI_DENTISTRY_YEAR_2_ID, tripoli_dentistry, "year-2", "Tripoli Dentistry — Year 2", "طب أسنان طرابلس سنة ثانية", 1),
        (TRIPOLI_DENTISTRY_YEAR_1_ID, tripoli_dentistry, "year-1", "Tripoli Dentistry — Year 1", "طب أسنان طرابلس سنة أولى", 2),
        (ZAWIYA_DENTISTRY_YEAR_2_ID, zawiya_dentistry, "year-2", "Zawiya Dentistry — Year 2", "طب أسنان زاوية سنة ثانية", 1),
        (BENGHAZI_DENTISTRY_YEAR_2_ID, benghazi_dentistry, "year-2", "Benghazi Dentistry — Year 2", "طب أسنان بنغازي سنة ثانية", 1),
        (TRIPOLI_PREPARATORY_ID, tripoli_medical_sciences, "preparatory", "Preparatory Medical Sciences — Tripoli", "تمهيدي علوم طبية طرابلس", 1),
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


class Migration(migrations.Migration):
    dependencies = [("education", "0004_seed_dentistry_and_preparatory_cohorts")]

    operations = [migrations.RunPython(seed_legacy_study_paths, migrations.RunPython.noop)]

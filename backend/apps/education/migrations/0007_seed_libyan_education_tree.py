"""Seed the selectable paths and their explicit content roots.

The records deliberately live in the existing EducationNode tree.  Cohorts only
point at their own year/batch root; matching subject titles are therefore never
treated as shared content.
"""

import uuid

from django.db import migrations


ZAWIYA_YEAR_1 = uuid.UUID("a19b3034-e038-46b8-8806-7b113329d005")
BENGHAZI_YEAR_1 = uuid.UUID("a19b3034-e038-46b8-8806-7b113329d006")


def seed_libyan_tree(apps, schema_editor):  # type: ignore[no-untyped-def]
    EducationNode = apps.get_model("education", "EducationNode")
    AcademicProgram = apps.get_model("education", "AcademicProgram")
    StudentCohort = apps.get_model("education", "StudentCohort")

    def node(parent, kind, slug, title, position):
        record = EducationNode.objects.filter(parent=parent, slug=slug).first()
        if record is None:
            record = EducationNode(parent=parent, kind=kind, slug=slug)
        record.kind = kind
        record.title = title
        record.position = position
        record.status = "published"
        record.is_discoverable = True
        record.depth = 0 if parent is None else parent.depth + 1
        record.path = f"/{record.id}/" if parent is None else f"{parent.path}{record.id}/"
        record.save()
        return record

    institution = node(None, "institution", "libyan-universities", "Libyan Universities", 1)
    colleges = {
        "tripoli": node(institution, "college", "tripoli", "Tripoli", 1),
        "benghazi": node(institution, "college", "benghazi", "Benghazi", 2),
        "zawiya": node(institution, "college", "zawiya", "Zawiya", 3),
    }

    first_year_subjects = (
        "Dental Anatomy", "Dental Material", "General Histology", "General Anatomy",
        "Physiology", "Biochemistry",
    )
    # These are the existing Year 2 Dentistry catalogue names.  They are copied
    # as structural nodes only; no sheets/questions are copied between colleges.
    second_year_subjects = (
        "Conservative", "Microbiology", "Pharmacy", "General pathology",
        "Oral histology", "Fixed prosthodontic", "Removeable prosthodontic",
    )
    cohort_ids = {
        ("tripoli", "year-1"): uuid.UUID("a19b3034-e038-46b8-8806-7b113329d002"),
        ("tripoli", "year-2"): uuid.UUID("a19b3034-e038-46b8-8806-7b113329d001"),
        ("benghazi", "year-1"): BENGHAZI_YEAR_1,
        ("benghazi", "year-2"): uuid.UUID("a19b3034-e038-46b8-8806-7b113329d004"),
        ("zawiya", "year-1"): ZAWIYA_YEAR_1,
        ("zawiya", "year-2"): uuid.UUID("a19b3034-e038-46b8-8806-7b113329d003"),
    }
    dentistry_programs = {
        "tripoli": ("dentistry-tripoli", "Dentistry — Tripoli", "طب الأسنان طرابلس", 2),
        "benghazi": ("dentistry-benghazi", "Dentistry — Benghazi", "طب الأسنان بنغازي", 3),
        "zawiya": ("dentistry-zawiya", "Dentistry — Zawiya", "طب الأسنان زاوية", 4),
    }
    for college_key, (code, name_en, name_ar, position) in dentistry_programs.items():
        program, _ = AcademicProgram.objects.get_or_create(
            code=code, defaults={"name_en": name_en, "name_ar": name_ar, "position": position, "is_active": True}
        )
        department = node(colleges[college_key], "department", "dentistry", "Dentistry", 1)
        for year_code, year_title, subjects, year_position in (
            ("year-1", "First Year", first_year_subjects, 1),
            ("year-2", "Second Year", second_year_subjects, 2),
        ):
            year = node(department, "academic_year", year_code, year_title, year_position)
            for subject_position, title in enumerate(subjects, 1):
                node(year, "subject", title.lower().replace(" ", "-").replace("/", "-"), title, subject_position)
            cohort_id = cohort_ids[(college_key, year_code)]
            cohort, _ = StudentCohort.objects.update_or_create(
                id=cohort_id,
                defaults={"program": program, "code": year_code, "name_en": f"{name_en} — {year_title}", "name_ar": name_ar, "is_active": True, "position": year_position},
            )
            cohort.content_nodes.set([year])

    medicine, _ = AcademicProgram.objects.get_or_create(
        code="human-medicine",
        defaults={"name_en": "Human Medicine", "name_ar": "الطب البشري", "position": 1, "is_active": True},
    )
    medicine_department = node(colleges["tripoli"], "department", "human-medicine", "Human Medicine", 2)
    for code, title, subjects, position in (
        ("60", "Batch 60", ("Histology 1", "Biochemistry 1", "Anatomy 1", "Physiology 1"), 1),
        ("61", "Batch 61", ("Intro Histology", "Intro Anatomy", "English", "IT"), 2),
    ):
        batch = node(medicine_department, "academic_year", f"batch-{code}", title, position)
        for subject_position, subject_title in enumerate(subjects, 1):
            node(batch, "subject", subject_title.lower().replace(" ", "-"), subject_title, subject_position)
        cohort = StudentCohort.objects.get(program=medicine, code=code)
        cohort.content_nodes.set([batch])


class Migration(migrations.Migration):
    dependencies = [("education", "0006_studentcohort_content_nodes")]

    operations = [migrations.RunPython(seed_libyan_tree, migrations.RunPython.noop)]

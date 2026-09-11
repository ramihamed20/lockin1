from django.db import migrations


def repair_dentistry_cohort_labels(apps, schema_editor):
    StudentCohort = apps.get_model("education", "StudentCohort")
    labels = {
        ("dentistry-tripoli", "year-1"): "طب أسنان طرابلس سنة أولى",
        ("dentistry-tripoli", "year-2"): "طب أسنان طرابلس سنة ثانية",
        ("dentistry-benghazi", "year-1"): "طب أسنان بنغازي سنة أولى",
        ("dentistry-benghazi", "year-2"): "طب أسنان بنغازي سنة ثانية",
        ("dentistry-zawiya", "year-1"): "طب أسنان زاوية سنة أولى",
        ("dentistry-zawiya", "year-2"): "طب أسنان زاوية سنة ثانية",
    }
    for (program_code, cohort_code), name_ar in labels.items():
        StudentCohort.objects.filter(program__code=program_code, code=cohort_code).update(
            name_ar=name_ar
        )


class Migration(migrations.Migration):
    dependencies = [("education", "0007_seed_libyan_education_tree")]

    operations = [migrations.RunPython(repair_dentistry_cohort_labels, migrations.RunPython.noop)]

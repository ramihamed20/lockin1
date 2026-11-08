"""Published Tripoli Dentistry midterms, academic year 2026–2027.

Source: the two faculty timetables supplied on 2026-11-04. Times are
Africa/Tripoli. The posters specify dates, not a restricted sheet syllabus;
use the existing dynamic published-sheet scope for each catalog subject.
"""

from datetime import date, time
from uuid import NAMESPACE_URL, uuid5

from django.db import migrations

# (catalog slug, January day, local start hour, minute). Faculty course codes
# are comments for auditing; subject identity remains the existing catalog FK.
EXAMS = {
    "year-1": (
        ("dental-material", 2, 9, 0),  # DS110: خواص مواد الأسنان
        ("biochemistry", 5, 10, 30),  # MS140
        ("dental-anatomy", 9, 9, 0),  # DS120
        ("general-histology", 12, 10, 30),  # MS120
        ("general-anatomy", 16, 9, 0),  # MS110
        ("physiology", 19, 10, 30),  # MS130
    ),
    "year-2": (
        ("removable-prosthodontic", 3, 9, 0),  # DS220
        ("pharmacy", 7, 10, 30),  # MS230: علم الأدوية
        ("oral-histology", 10, 9, 0),  # DS240
        ("fixed-prosthodontic", 14, 10, 30),  # DS230
        ("general-pathology", 17, 9, 0),  # MS210
        ("conservative", 21, 10, 30),  # DS210
        ("microbiology", 24, 9, 0),  # MS220
    ),
}


def seed_exams(apps, schema_editor):  # type: ignore[no-untyped-def]
    alias = schema_editor.connection.alias
    Cohort = apps.get_model("education", "StudentCohort")
    Subject = apps.get_model("content", "CatalogSubject")
    Period = apps.get_model("study_plans", "ExamPeriod")
    Schedule = apps.get_model("study_plans", "ExamSchedule")
    Scope = apps.get_model("study_plans", "ExamSyllabusScope")
    for year, rows in EXAMS.items():
        # Migration tests and fresh installations can have no catalog cohorts yet.
        # Do not fabricate exam periods for absent cohorts; if the cohort exists,
        # all its published subjects must still pass the strict checks below.
        cohort = (
            Cohort.objects.using(alias)
            .filter(program__code="dentistry-tripoli", code=year)
            .first()
        )
        if cohort is None:
            continue
        subjects = []
        for slug, *_ in rows:
            subject = (
                Subject.objects.using(alias)
                .select_related("source_node")
                .get(cohort=cohort, slug=slug)
            )
            node = subject.source_node
            # Require the exact Tripoli/year hierarchy. Never match another
            # cohort's subjects by title, and fail atomically on missing data.
            if node is None or node.parent.slug != year or node.parent.parent.slug != "dentistry":
                raise ValueError(f"Invalid exam subject hierarchy: dentistry-tripoli/{year}/{slug}")
            if node.parent.parent.parent.slug != "tripoli":
                raise ValueError(f"Exam subject is outside Tripoli: {slug}")
            institution = node
            while institution.parent_id is not None:
                institution = institution.parent
            if institution.kind != "institution":
                raise ValueError(f"Missing institution for exam subject: {slug}")
            subjects.append((subject, institution))
        period_id = uuid5(NAMESPACE_URL, f"lockin:dentistry-tripoli:{year}:midterm:2026-2027")
        period, _ = Period.objects.using(alias).update_or_create(
            id=period_id,
            defaults={
                "title": f"نصفي أسنان طرابلس — {'السنة الأولى' if year == 'year-1' else 'السنة الثانية'} — 2026/2027",
                "institution_id": subjects[0][1].pk,
                "cohort_id": cohort.pk,
                "kind": "midterm",
                "starts_on": date(2027, 1, rows[0][1]),
                "ends_on": date(2027, 1, rows[-1][1]),
                "status": "confirmed",
            },
        )
        for (subject, _), (_, day, hour, minute) in zip(subjects, rows, strict=True):
            Schedule.objects.using(alias).update_or_create(
                period=period,
                subject=subject,
                exam_type="theory",
                defaults={
                    "scheduled_on": date(2027, 1, day),
                    "starts_at": time(hour, minute),
                    "ends_at": time(hour + 1, minute),
                    "timezone": "Africa/Tripoli",
                    "status": "confirmed",
                },
            )
            # Re-running the seed must not reset an administrator's explicit syllabus.
            Scope.objects.using(alias).get_or_create(period=period, subject=subject)


class Migration(migrations.Migration):
    dependencies = [
        ("study_plans", "0012_exam_schedule_times"),
        ("content", "0007_backfill_catalog_subjects"),
    ]

    # Retain exam history and any learner references on rollback.
    operations = [migrations.RunPython(seed_exams, migrations.RunPython.noop)]

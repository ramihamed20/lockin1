"""Tripoli Human Medicine batches 60/61: 2026-27 final exam planning.

The supplied academic calendar confirms only the theoretical exam window,
21 December 2026 to 21 January 2027. Individual subject dates below are
deliberately staggered in a sample/shuffled order, NOT a faculty timetable.
Keep those schedules tentative, without invented exam times.
"""

from datetime import date
from uuid import NAMESPACE_URL, uuid5

from django.db import migrations

START = date(2026, 12, 21)
END = date(2027, 1, 21)

# The dates are planning placeholders, not officially published subject dates.
# Slugs are the existing cohort-specific catalog subjects from education.0007.
SAMPLE_EXAMS = {
    "60": (
        ("physiology-1", date(2026, 12, 23)),
        ("anatomy-1", date(2027, 1, 2)),
        ("histology-1", date(2027, 1, 11)),
        ("biochemistry-1", date(2027, 1, 19)),
    ),
    "61": (
        ("it", date(2026, 12, 24)),
        ("intro-anatomy", date(2027, 1, 3)),
        ("english", date(2027, 1, 12)),
        ("intro-histology", date(2027, 1, 20)),
    ),
}


def seed_medicine_finals(apps, schema_editor):  # type: ignore[no-untyped-def]
    alias = schema_editor.connection.alias
    Cohort = apps.get_model("education", "StudentCohort")
    Subject = apps.get_model("content", "CatalogSubject")
    Period = apps.get_model("study_plans", "ExamPeriod")
    Schedule = apps.get_model("study_plans", "ExamSchedule")
    Scope = apps.get_model("study_plans", "ExamSyllabusScope")

    for batch_code, entries in SAMPLE_EXAMS.items():
        cohort = (
            Cohort.objects.using(alias)
            .filter(program__code="human-medicine", code=batch_code)
            .first()
        )
        if cohort is None:
            continue

        subjects = []
        for slug, exam_date in entries:
            if not START <= exam_date <= END:
                raise ValueError(f"Sample date outside exam period: {batch_code}/{slug}")
            subject = (
                Subject.objects.using(alias)
                .select_related("source_node__parent__parent__parent")
                .get(cohort=cohort, slug=slug)
            )
            node = subject.source_node
            if (
                node is None
                or node.parent is None
                or node.parent.slug != f"batch-{batch_code}"
                or node.parent.parent is None
                or node.parent.parent.slug != "human-medicine"
                or node.parent.parent.parent is None
                or node.parent.parent.parent.slug != "tripoli"
            ):
                raise ValueError(f"Invalid Tripoli medicine subject: {batch_code}/{slug}")
            institution = node
            while institution.parent_id is not None:
                institution = institution.parent
            if institution.kind != "institution":
                raise ValueError(f"No institution found for: {batch_code}/{slug}")
            subjects.append((subject, institution, exam_date))

        period_id = uuid5(
            NAMESPACE_URL, f"lockin:human-medicine:tripoli:batch-{batch_code}:final:2026-2027"
        )
        period, _ = Period.objects.using(alias).update_or_create(
            id=period_id,
            defaults={
                "title": (
                    f"نهائي الطب البشري طرابلس — دفعة {batch_code} — 2026/2027"
                    " (مواعيد المواد تقديرية)"
                ),
                "institution_id": subjects[0][1].pk,
                "cohort_id": cohort.pk,
                "kind": "final",
                "starts_on": START,
                "ends_on": END,
                "status": "confirmed",
            },
        )
        for subject, _, exam_date in subjects:
            Schedule.objects.using(alias).update_or_create(
                period=period,
                subject=subject,
                exam_type="theory",
                defaults={
                    "scheduled_on": exam_date,
                    "starts_at": None,
                    "ends_at": None,
                    "timezone": "Africa/Tripoli",
                    "status": "tentative",
                },
            )
            # An operator's explicitly frozen sheet scope must be preserved.
            Scope.objects.using(alias).get_or_create(period=period, subject=subject)


class Migration(migrations.Migration):
    dependencies = [
        ("study_plans", "0016_subject_readiness"),
        ("content", "0007_backfill_catalog_subjects"),
    ]
    operations = [migrations.RunPython(seed_medicine_finals, migrations.RunPython.noop)]

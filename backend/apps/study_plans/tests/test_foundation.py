from datetime import timedelta
from uuid import uuid4

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.models import (
    CatalogDocument,
    CatalogSubject,
    CatalogWorkspaceSnapshot,
    LearningObjectAsset,
    LearningObjectVersion,
)
from apps.content.tests.helpers import published_pdf
from apps.education.models import AcademicProgram, StudentCohort
from apps.education.services import create_node
from apps.education.tests.helpers import create_admin, published_path
from apps.focus.models import (
    ActiveStudyAttempt,
    ActiveStudyRun,
    FocusSession,
    FocusWorkspaceSnapshot,
)
from apps.progress.models import LearningProgress
from apps.review.models import ReviewItem

from ..exam_models import ExamPeriod, ExamSchedule, ExamSyllabusScope
from ..learning_snapshot import student_learning_snapshot
from ..models import StudyPlanItem
from .test_api import authenticated_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def curriculum(settings):
    settings.STUDY_PLAN_V2_ENABLED = True
    settings.STUDY_PLAN_V2_USER_IDS = []
    admin = create_admin()
    institution, node, lesson = published_path(admin=admin)
    program = AcademicProgram.objects.create(code="dental", name_en="Dental", name_ar="أسنان")
    cohort = StudentCohort.objects.create(
        program=program,
        code="year2",
        name_en="Year 2",
        name_ar="الثانية",
    )
    cohort.content_nodes.add(node)
    subject = CatalogSubject.objects.create(
        cohort=cohort,
        source_node=node,
        title="Anatomy",
        slug="anatomy",
        material_slug="d2-anatomy",
    )
    user = create_user(cohort=cohort, with_trial=True)
    period = ExamPeriod.objects.create(
        title="Dental midterm",
        institution=institution,
        cohort=cohort,
        starts_on=timezone.localdate() + timedelta(days=69),
        status="tentative",
    )
    scope = ExamSyllabusScope.objects.create(period=period, subject=subject)
    sheet = published_pdf(actor=admin, node=lesson)
    return {
        "admin": admin,
        "user": user,
        "period": period,
        "scope": scope,
        "subject": subject,
        "lesson": lesson,
        "sheet": sheet,
    }


def snapshot(data):
    return student_learning_snapshot(user=data["user"], period=data["period"])


def path(data):
    return f"/api/v1/study-plan/v2/exams/{data['period'].pk}/snapshot"


def test_flag_is_closed_by_default_and_can_restrict_pilot(curriculum, settings):
    client = authenticated_client(curriculum["user"])
    settings.STUDY_PLAN_V2_ENABLED = False
    assert client.get(path(curriculum)).status_code == 403
    settings.STUDY_PLAN_V2_ENABLED = True
    settings.STUDY_PLAN_V2_USER_IDS = [str(uuid4())]
    assert client.get(path(curriculum)).status_code == 403
    settings.STUDY_PLAN_V2_USER_IDS = [str(curriculum["user"].pk)]
    assert client.get(path(curriculum)).status_code == 200
    access = client.get("/api/v1/study-plan/v2/exams").json()
    assert access["enabled"] is True and access["schema_version"] == 1
    assert access["results"][0]["id"] == str(curriculum["period"].pk)
    # Closing the pilot does not change the existing student planner.
    settings.STUDY_PLAN_V2_ENABLED = False
    today = timezone.localdate()
    assert client.get(f"/api/v1/study-plan?from={today}&to={today}").status_code == 200


def test_exam_list_is_scoped_even_when_legacy_cohort_gate_is_disabled(curriculum):
    other_cohort = StudentCohort.objects.create(
        program=curriculum["user"].cohort.program,
        code="year1",
        name_en="Year 1",
        name_ar="الأولى",
    )
    other = create_user(email="other@example.com", cohort=other_cohort, with_trial=True)
    client = authenticated_client(other)
    with override_settings(COHORT_CONTENT_ENFORCEMENT=False):
        assert client.get("/api/v1/study-plan/v2/exams").json()["results"] == []
        assert client.get(path(curriculum)).status_code == 404
    curriculum["user"].cohort = other_cohort
    curriculum["user"].save()
    assert authenticated_client(curriculum["user"]).get(path(curriculum)).status_code == 404


def test_drafts_and_inactive_placements_are_hidden(curriculum):
    client = authenticated_client(curriculum["user"])
    period = curriculum["period"]
    period.status = "draft"
    period.save()
    assert client.get(path(curriculum)).status_code == 404
    period.status = "tentative"
    period.save()
    cohort = curriculum["user"].cohort
    cohort.is_active = False
    cohort.save()
    assert client.get(path(curriculum)).status_code == 404


def test_authentication_and_subscription_stay_authoritative(curriculum):
    assert APIClient().get(path(curriculum)).status_code == 403
    user = create_user(
        email="unverified@example.com", verified=False, cohort=curriculum["user"].cohort
    )
    assert authenticated_client(user).get(path(curriculum)).status_code == 403
    assert not StudyPlanItem.objects.filter(user=user).exists()


def test_new_publications_enter_dynamic_scope_and_leave_explicit_scope_untouched(curriculum):
    initial = snapshot(curriculum)
    assert initial["sheet_count"] == 1
    new_sheet = published_pdf(
        actor=curriculum["admin"],
        node=curriculum["lesson"],
        title="New sheet",
    )
    updated = snapshot(curriculum)
    assert updated["sheet_count"] == 2
    assert initial["syllabus_fingerprint"] != updated["syllabus_fingerprint"]
    scope = curriculum["scope"]
    scope.include_future_sheets = False
    scope.save()
    scope.sheets.set([curriculum["sheet"]])
    explicit = snapshot(curriculum)
    assert explicit["sheet_count"] == 1
    new_sheet.archived_at = timezone.now()
    new_sheet.save()
    assert snapshot(curriculum)["syllabus_fingerprint"] == explicit["syllabus_fingerprint"]
    # Even an explicitly selected sheet is excluded when publication is revoked.
    scope.sheets.add(new_sheet)
    assert snapshot(curriculum)["sheet_count"] == 1


def test_available_dates_discoverability_and_scope_membership_are_rechecked(curriculum):
    sheet = curriculum["sheet"]
    version = sheet.published_version
    version.available_from = timezone.now() + timedelta(days=1)
    version.save()
    assert snapshot(curriculum)["sheet_count"] == 0
    version.available_from = None
    version.save()
    node = curriculum["lesson"]
    node.is_discoverable = False
    node.save()
    assert snapshot(curriculum)["sheet_count"] == 0


def test_snapshot_keeps_reading_scoring_and_mastery_separate_and_is_read_only(curriculum):
    user, sheet = curriculum["user"], curriculum["sheet"]
    version = sheet.published_version
    LearningProgress.objects.create(
        user=user,
        learning_object=sheet,
        version=version,
        status="in_progress",
        completion_percent=80,
        position={"page": 8},
    )
    run = ActiveStudyRun.objects.create(
        user=user,
        sheet=sheet,
        material_slug="",
        sheet_slug="",
        difficulty="easy",
        page_count=10,
    )
    ActiveStudyAttempt.objects.create(
        run=run,
        kind="checkpoint",
        part_number=1,
        number=1,
        score=12,
        total=15,
        passed=True,
        submitted_at=timezone.now(),
    )
    # An unsubmitted attempt contributes neither a score nor a question total.
    ActiveStudyAttempt.objects.create(run=run, kind="final", number=1, total=50)
    ReviewItem.objects.create(
        user=user,
        canonical_key="study:1",
        subject=version.academic_node,
        subject_key=f"content:{version.academic_node_id}",
        source_type="active_study",
        prompt_snapshot="A question",
        next_review_at=timezone.now() - timedelta(minutes=1),
        first_mistake_at=timezone.now(),
        last_mistake_at=timezone.now(),
        mistake_count=2,
    )
    legacy = StudyPlanItem.objects.create(
        user=user,
        title="Existing work",
        scheduled_date=timezone.localdate(),
        status="completed",
        completed_at=timezone.now(),
    )
    with CaptureQueriesContext(connection) as queries:
        result = snapshot(curriculum)
    assert not any(
        q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) for q in queries
    )
    entry = result["subjects"][0]["sheets"][0]
    assert entry["reading"]["completion_percent"] == 80
    assert entry["active_study"][0]["correct"] == 12
    assert entry["active_study"][0]["total"] == 15
    assert entry["active_study"][0]["version_verified"] is False
    assert result["mastery"] is None and result["planner_ready"] is False
    assert result["subjects"][0]["review"] == {
        "active_count": 1,
        "due_count": 1,
        "repeated_mistakes": 1,
    }
    assert StudyPlanItem.objects.filter(user=user).count() == 1
    legacy.refresh_from_db()
    assert legacy.status == "completed" and legacy.revision == 1


def test_subject_schedule_overrides_only_its_own_deadline_reference(curriculum):
    period, subject = curriculum["period"], curriculum["subject"]
    result = snapshot(curriculum)
    assert result["subjects"][0]["deadline_source"] == "period_start"
    ExamSchedule.objects.create(
        period=period,
        subject=subject,
        scheduled_on=period.starts_on + timedelta(days=4),
        exam_type="practical",
        status="confirmed",
    )
    updated = snapshot(curriculum)
    assert updated["subjects"][0]["deadline_source"] == "subject_schedule"
    assert updated["subjects"][0]["schedules"][0]["exam_type"] == "practical"
    assert updated["syllabus_fingerprint"] != result["syllabus_fingerprint"]
    assert updated["exam"]["status"] == "tentative"


def test_cross_cohort_and_cross_institution_exam_configuration_is_rejected(curriculum):
    period, subject = curriculum["period"], curriculum["subject"]
    ExamSchedule(
        period=period,
        subject=subject,
        scheduled_on=period.starts_on,
    ).full_clean()
    other = StudentCohort.objects.create(
        program=period.cohort.program,
        code="other",
        name_en="Other",
        name_ar="Other",
    )
    subject.cohort = other
    subject.save()
    with pytest.raises(ValidationError, match="exam cohort"):
        ExamSchedule(period=period, subject=subject, scheduled_on=period.starts_on).full_clean()
    assert snapshot(curriculum)["subjects"] == []
    period.cohort = other
    wrong_institution = create_node(
        actor=curriculum["admin"],
        parent=None,
        kind="institution",
        title="Another university",
    )
    period.institution = wrong_institution
    with pytest.raises(ValidationError, match="exam institution"):
        ExamSyllabusScope(period=period, subject=subject).clean()


def test_date_order_and_duplicate_schedules_have_database_constraints(curriculum):
    period, subject = curriculum["period"], curriculum["subject"]
    with pytest.raises(IntegrityError), transaction.atomic():
        ExamPeriod.objects.filter(pk=period.pk).update(ends_on=period.starts_on - timedelta(days=1))
    ExamSchedule.objects.create(period=period, subject=subject, scheduled_on=period.starts_on)
    with pytest.raises(IntegrityError), transaction.atomic():
        ExamSchedule.objects.create(period=period, subject=subject, scheduled_on=period.starts_on)
    with pytest.raises(ValidationError):
        ExamSchedule(
            period=period, subject=subject, scheduled_on=period.starts_on - timedelta(days=1)
        ).full_clean()


def test_missing_parent_fields_report_validation_errors_instead_of_crashing(curriculum):
    period = curriculum["period"]
    period.starts_on = None
    with pytest.raises(ValidationError, match="cannot be null"):
        period.full_clean()
    period.institution = None
    with pytest.raises(ValidationError):
        period.full_clean()


@pytest.mark.parametrize("start,end", [(0, 5), (5, 4), (None, 5), (5, None)])
def test_linked_task_page_bounds_are_enforced(curriculum, start, end):
    with pytest.raises(IntegrityError), transaction.atomic():
        StudyPlanItem.objects.create(
            user=curriculum["user"],
            title="Bad range",
            scheduled_date=timezone.localdate(),
            content_version=curriculum["sheet"].published_version,
            page_start=start,
            page_end=end,
        )


def test_task_anchors_survive_subject_renames(curriculum):
    subject, version = curriculum["subject"], curriculum["sheet"].published_version
    task = StudyPlanItem.objects.create(
        user=curriculum["user"],
        title="Read",
        subject=subject.title,
        catalog_subject=subject,
        content_version=version,
        activity="reading",
        page_start=2,
        page_end=5,
        scheduled_date=timezone.localdate(),
    )
    subject.title = "Renamed subject"
    subject.save()
    task.refresh_from_db()
    assert task.catalog_subject_id == subject.id and task.content_version_id == version.id
    task.full_clean()


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_sheet_growth_does_not_add_queries_per_sheet(curriculum):
    # Warm account/cohort permission caches before comparing curriculum sizes.
    snapshot(curriculum)
    with CaptureQueriesContext(connection) as first_queries:
        snapshot(curriculum)
    for index in range(3):
        published_pdf(actor=curriculum["admin"], node=curriculum["lesson"], title=f"Sheet {index}")
    with CaptureQueriesContext(connection) as more_queries:
        result = snapshot(curriculum)
    assert result["sheet_count"] == 4
    assert len(more_queries) == len(first_queries)


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_exam_membership_does_not_bypass_the_readers_content_scopes(curriculum):
    curriculum["user"].cohort.content_nodes.clear()
    assert snapshot(curriculum)["sheet_count"] == 0


def test_two_pdf_editions_have_separate_page_counts(curriculum):
    version = curriculum["sheet"].published_version
    version.page_count = 8
    version.save()
    primary = version.assets.get(role="primary")
    primary.managed_file.pdf_page_count = 8
    primary.managed_file.save()
    second_sheet = published_pdf(
        actor=curriculum["admin"], node=curriculum["lesson"], title="Other PDF"
    )
    second_file = second_sheet.published_version.assets.get(role="primary").managed_file
    second_file.pdf_page_count = 20
    second_file.save()
    LearningObjectAsset.objects.create(
        version=version, managed_file=second_file, role="lockin_primary"
    )
    entry = next(
        s
        for s in snapshot(curriculum)["subjects"][0]["sheets"]
        if s["sheet_id"] == str(curriculum["sheet"].id)
    )
    assert {e["edition"]: e["page_count"] for e in entry["editions"]} == {
        "university": 8,
        "lockin": 20,
    }


def test_snapshot_response_has_no_question_answers_or_write_endpoints(curriculum):
    client = authenticated_client(curriculum["user"])
    response = client.get(path(curriculum))
    assert response.status_code == 200
    assert response.json()["exam"]["id"] == str(curriculum["period"].pk)
    assert "correct_option" not in response.content.decode()
    assert client.post(path(curriculum), {}, format="json").status_code == 405


def test_reader_positions_use_latest_version_and_file_without_certifying_progress(curriculum):
    user = curriculum["user"]
    version = curriculum["sheet"].published_version
    file_id = version.assets.get(role="primary").managed_file_id
    for page, version_id, anchor_file in [
        (2, version.id, file_id),
        (5, version.id, file_id),
        (8, uuid4(), file_id),
        (9, version.id, uuid4()),
    ]:
        FocusWorkspaceSnapshot.objects.create(
            user=user,
            session=FocusSession.objects.create(user=user),
            document_id=uuid4(),
            document_version_id=version_id,
            file_id=anchor_file,
            current_page=page,
        )
    entry = snapshot(curriculum)["subjects"][0]["sheets"][0]
    assert len(entry["reader_positions"]) == 1
    assert entry["reader_positions"][0]["page"] == 5
    assert entry["reading"] is None


def test_old_pdf_completion_is_not_attached_to_a_new_version(curriculum):
    user, sheet = curriculum["user"], curriculum["sheet"]
    old = sheet.published_version
    LearningProgress.objects.create(
        user=user,
        learning_object=sheet,
        version=old,
        status="completed",
        completion_percent=100,
        completed_at=timezone.now(),
    )
    new = LearningObjectVersion.objects.create(
        learning_object=sheet,
        version_number=2,
        academic_node=old.academic_node,
        content_type="pdf",
        title="Revised PDF",
        created_by=curriculum["admin"],
    )
    sheet.published_version = new
    sheet.save()
    entry = snapshot(curriculum)["subjects"][0]["sheets"][0]
    assert entry["version_id"] == str(new.id) and entry["reading"] is None


def test_catalog_reader_position_is_kept_as_unverified_evidence(curriculum):
    version = curriculum["sheet"].published_version
    document, _ = CatalogDocument.objects.get_or_create(
        version=version,
        edition="university",
        defaults={
            "material_slug": curriculum["subject"].material_slug,
            "sheet_slug": "first",
            "managed_file": version.assets.get(role="primary").managed_file,
        },
    )
    CatalogWorkspaceSnapshot.objects.create(
        user=curriculum["user"],
        document=document,
        state={"view": {"page": 3}, "notes": "Private note", "annotations": ["Private ink"]},
    )
    entry = snapshot(curriculum)["subjects"][0]["sheets"][0]
    assert entry["reader_positions"][0]["page"] == 3
    assert entry["reader_positions"][0]["version_verified"] is False
    assert "Private" not in str(entry)


def test_exam_admin_enforces_model_permissions(curriculum, client):
    user = curriculum["user"]
    user.is_staff = True
    user.save()
    client.force_login(user)
    assert client.get("/admin/study_plans/examperiod/").status_code == 403
    assert client.post("/admin/study_plans/examperiod/add/", {}).status_code == 403
    user.is_superuser = True
    user.save()
    client.force_login(user)
    assert client.get("/admin/study_plans/examperiod/add/").status_code == 200

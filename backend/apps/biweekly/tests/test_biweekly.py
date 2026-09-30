from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.core.files.base import ContentFile
from django.template.loader import render_to_string
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.tests.helpers import create_admin, published_path
from apps.focus.models import FocusSession
from apps.questions.answering import answer_question
from apps.questions.tests.helpers import published_question
from apps.review.models import MistakeEvent, ReviewItem

from ..models import BiweeklySnapshot
from ..pdf import _review_context
from ..services import ANCHOR, PERIOD, create_snapshot, most_recent_closed, period_at

pytestmark = pytest.mark.django_db


def closed_period():
    period = most_recent_closed()
    assert period is not None
    return period


def question(index, *, kind="single_choice", long=False):
    return {
        "review_item_id": str(uuid4()),
        "question_id": None,
        "question_version_id": None,
        "subject": "Oral Pathology",
        "sheet": "Sheet 1",
        "edition": "University",
        "source_page": 3,
        "source_type": "sheet",
        "source_label": "Sheet 1",
        "question_number": index,
        "question_type": kind,
        "prompt": ("Why does this happen? " * 100 if long else f"Question {index}?"),
        "options": [
            {"id": "a", "text": "First"},
            {"id": "b", "text": "Second"},
            {"id": "c", "text": "Third"},
        ],
        "correct_option_ids": ["a", "c"] if kind == "multiple_select" else ["a"],
        "student_answers": ["Second"],
        "correct_answers": ["First"],
        "explanation": ("Long explanation. " * 120 if long else "Because the source says so."),
        "repetitions": 1,
    }


def test_fixed_half_open_boundaries_and_no_active_period_snapshot():
    assert period_at(ANCHOR) == (ANCHOR, ANCHOR + PERIOD)
    assert period_at(ANCHOR + PERIOD - timedelta(microseconds=1))[0] == ANCHOR
    assert period_at(ANCHOR + PERIOD)[0] == ANCHOR + PERIOD
    user = create_user(with_trial=True)
    active_start, active_end = period_at(datetime.now(UTC))
    with pytest.raises(ValueError, match="active period"):
        create_snapshot(user=user, report_type="analysis", start=active_start, end=active_end)


def test_idempotent_frozen_analysis_and_first_period_comparison():
    user = create_user(with_trial=True)
    start, end = closed_period()
    session = FocusSession.objects.create(
        user=user,
        status=FocusSession.Status.COMPLETED,
        started_at=start + timedelta(days=1),
        ended_at=start + timedelta(days=1, hours=1),
        active_duration_seconds=3600,
    )
    first = create_snapshot(user=user, report_type="analysis", start=start, end=end)
    session.active_duration_seconds = 9999
    session.save(update_fields=["active_duration_seconds"])
    same = create_snapshot(user=user, report_type="analysis", start=start, end=end)
    assert same.id == first.id
    assert same.data["metrics"]["study_time_seconds"] == 3600
    assert same.data["previous_period_metrics"] is None
    assert (
        BiweeklySnapshot.objects.filter(
            user=user, report_type="analysis", period_start=start
        ).count()
        == 1
    )


def test_immediately_previous_period_only_and_history_ordering():
    user = create_user(with_trial=True)
    older_start = ANCHOR
    newest_start = ANCHOR + PERIOD
    newest_end = newest_start + PERIOD
    with patch("apps.biweekly.services.timezone.now", return_value=newest_end):
        previous = create_snapshot(
            user=user, report_type="analysis", start=older_start, end=newest_start
        )
        current = create_snapshot(
            user=user, report_type="analysis", start=newest_start, end=newest_end
        )
    assert current.data["previous_period_metrics"] == previous.data["metrics"]
    assert list(
        BiweeklySnapshot.objects.filter(user=user, report_type="analysis").values_list(
            "id", flat=True
        )
    ) == [current.id, previous.id]


def test_review_freezes_existing_mistake_without_copying_question_bank():
    user = create_user(with_trial=True)
    start, end = closed_period()
    client = APIClient()
    client.force_authenticate(user)
    response = client.post(
        "/api/v1/question-attempts",
        {
            "idempotency_key": str(uuid4()),
            "question_key": "sheet:q1",
            "subject_key": "oral",
            "subject_label": "Oral Pathology",
            "source_type": "sheet",
            "source_id": "sheet-1",
            "source_label": "Sheet 1",
            "source_question_index": 1,
            "prompt": "Original text?",
            "explanation": "Original reason.",
            "options": [{"id": "a", "text": "First"}, {"id": "b", "text": "Second"}],
            "selected_option_ids": ["b"],
            "correct_option_ids": ["a"],
        },
        format="json",
    )
    assert response.status_code == 201
    MistakeEvent.objects.filter(user=user).update(answered_at=start + timedelta(days=1))
    report = create_snapshot(user=user, report_type="review", start=start, end=end)
    item = ReviewItem.objects.get(user=user)
    item.prompt_snapshot = "Later edit"
    item.save(update_fields=["prompt_snapshot"])
    assert report.data["questions"][0]["prompt"] == "Original text?"
    assert report.data["questions"][0]["review_item_id"] == str(item.id)
    assert report.data["mistake_count"] == 1


def test_wrong_normal_question_enters_existing_review_with_versioned_content():
    admin = create_admin()
    student = create_user(with_trial=True)
    _, _, lesson = published_path(admin=admin)
    question_object = published_question(actor=admin, node=lesson)
    version = question_object.published_version
    wrong_id = next(option.id for option in version.options.all() if not option.is_correct)
    answer, created = answer_question(user=student, question=question_object, choice_ids=[wrong_id])
    event = MistakeEvent.objects.get(user=student)
    assert created and not answer.is_correct
    assert event.review_item.question_id == question_object.id
    assert event.question_version_id_snapshot == version.id
    assert event.question_type_snapshot == "single_choice"
    assert event.options_snapshot
    assert event.explanation_snapshot == version.explanation


def test_owner_only_history_and_old_report_stays_available_after_new_period():
    owner = create_user(email="biweekly-owner@example.com", with_trial=True)
    stranger = create_user(email="biweekly-stranger@example.com", with_trial=True)
    start, end = closed_period()
    report = create_snapshot(user=owner, report_type="review", start=start, end=end)
    owner_client, stranger_client = APIClient(), APIClient()
    owner_client.force_authenticate(owner)
    stranger_client.force_authenticate(stranger)
    assert owner_client.get("/api/v1/biweekly/review").status_code == 200
    assert owner_client.get(f"/api/v1/biweekly/review/{report.id}").status_code == 200
    assert stranger_client.get(f"/api/v1/biweekly/review/{report.id}").status_code == 404
    assert stranger_client.get(f"/api/v1/biweekly/review/{report.id}/pdf").status_code == 404
    assert all(
        row["id"] != str(report.id)
        for row in stranger_client.get("/api/v1/biweekly/review").json()["history"]
    )


def test_private_old_pdf_download_remains_repeatable_after_new_report(tmp_path, settings):
    settings.MEDIA_ROOT = tmp_path
    user = create_user(with_trial=True)
    start, end = closed_period()
    old = BiweeklySnapshot.objects.create(
        user=user,
        report_type="analysis",
        period_start=start,
        period_end=end,
        data={"metrics": {"questions_answered": 7}},
    )
    old.pdf.save("old.pdf", ContentFile(b"%PDF-1.4 old frozen report"))
    client = APIClient()
    client.force_authenticate(user)
    url = f"/api/v1/biweekly/analysis/{old.id}/pdf"
    first = client.get(url)
    assert first.status_code == 200
    assert b"".join(first.streaming_content) == b"%PDF-1.4 old frozen report"
    newer = BiweeklySnapshot.objects.create(
        user=user,
        report_type="analysis",
        period_start=end,
        period_end=end + PERIOD,
        data={"metrics": {"questions_answered": 99}},
    )
    second = client.get(url)
    assert second.status_code == 200
    assert b"".join(second.streaming_content) == b"%PDF-1.4 old frozen report"
    assert newer.id != old.id
    assert "lockin-analysis-" in second["Content-Disposition"]


@pytest.mark.parametrize("count", [0, 1, 3, 4, 32, 100])
def test_review_template_groups_three_normal_cards_without_fixed_limit(count):
    user = create_user(with_trial=True)
    start, end = closed_period()
    report = BiweeklySnapshot.objects.create(
        user=user,
        report_type="review",
        period_start=start,
        period_end=end,
        data={"questions": [question(index) for index in range(count)], "mistake_count": count},
    )
    context = _review_context(report)
    assert len(context["pages"]) == (count + 2) // 3
    assert all(len(page["questions"]) <= 3 for page in context["pages"])
    html = render_to_string(
        "biweekly/review.html",
        {
            "report": report,
            "pages": context["pages"],
            "mistake_count": count,
            "period_label": "test",
        },
    )
    assert html.count('class="question-card') == count
    assert html.count("Because the source says so.") == count


def test_long_explanation_is_not_truncated_in_review_template():
    user = create_user(with_trial=True)
    start, end = closed_period()
    row = question(1, long=True)
    report = BiweeklySnapshot.objects.create(
        user=user,
        report_type="review",
        period_start=start,
        period_end=end,
        data={"questions": [row], "mistake_count": 1},
    )
    pages = _review_context(report)["pages"]
    html = render_to_string(
        "biweekly/review.html",
        {"report": report, "pages": pages, "mistake_count": 1, "period_label": "test"},
    )
    assert pages[0]["questions"][0]["long"] is True
    assert "Long explanation. " * 120 in html


@pytest.mark.parametrize(
    "kind,selected,correct",
    [
        ("single_choice", ["a"], True),
        ("true_false", ["b"], False),
        ("multiple_select", ["a"], False),
        ("multiple_select", ["a", "c"], True),
    ],
)
def test_frozen_review_test_preserves_exact_set_grading(kind, selected, correct):
    user = create_user(with_trial=True)
    start, end = closed_period()
    row = question(1, kind=kind)
    report = BiweeklySnapshot.objects.create(
        user=user,
        report_type="review",
        period_start=start,
        period_end=end,
        data={"questions": [row], "mistake_count": 1},
    )
    client = APIClient()
    client.force_authenticate(user)
    url = f"/api/v1/biweekly/review/{report.id}/test"
    before = client.get(url).json()
    assert "correct_option_ids" not in before["questions"][0]
    response = client.post(url, {"answers": {row["review_item_id"]: selected}}, format="json")
    assert response.status_code == 201
    assert response.json()["result"][row["review_item_id"]]["was_correct"] is correct
    assert (
        client.post(url, {"answers": {row["review_item_id"]: ["b"]}}, format="json").json()
        == response.json()
    )

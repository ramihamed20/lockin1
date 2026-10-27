from datetime import UTC, datetime, timedelta
from importlib import import_module
from types import SimpleNamespace
from uuid import uuid4

import pytest
from django.apps import apps
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.education.models import AcademicProgram, StudentCohort
from apps.rankings.live import live_ranking, period_bounds
from apps.rankings.models import RankingFact, RankingProfile
from apps.rankings.services import record_ranking_fact

pytestmark = pytest.mark.django_db


@pytest.fixture
def cohort():
    program = AcademicProgram.objects.create(code="rank-test", name_en="Dentistry")
    return StudentCohort.objects.create(program=program, code="year-2", name_en="Year 2")


def fact(user, points=100, at=None, valid=True, transaction_id=None):
    row, _ = record_ranking_fact(
        user_id=user.id,
        source_transaction_id=transaction_id or uuid4(),
        source_key=f"study:{uuid4()}",
        points=points,
        category="learning",
        occurred_at=at or timezone.now(),
    )
    if not valid:
        row.is_valid = False
        row.save(update_fields=["is_valid"])
    return row


def test_live_scores_are_cohort_scoped_valid_deduplicated_and_tied(cohort):
    viewer = create_user(cohort=cohort)
    peer = create_user(email="peer@test.com", cohort=cohort)
    other = create_user(email="other@test.com")
    disabled = create_user(email="disabled@test.com", cohort=cohort, is_active=False)
    User.objects.filter(pk=disabled.id).update(is_active=False)
    suspended = create_user(email="suspended@test.com", cohort=cohort, status=User.Status.SUSPENDED)
    source = uuid4()
    fact(viewer, 100, transaction_id=source)
    fact(viewer, 100, transaction_id=source)
    fact(viewer, 999, valid=False)
    fact(viewer, 999, at=timezone.now() + timedelta(days=1))
    fact(peer, 100)
    fact(other, 1000)
    fact(disabled, 1000)
    fact(suspended, 1000)
    data = live_ranking(viewer=viewer)
    assert data["participant_count"] == 2
    assert [row["position"] for row in data["entries"]] == [1, 1]
    assert data["own_entry"]["score"] == 100
    assert data["own_entry"]["evidence_count"] == 1
    assert data["points_to_next_rank"] is None


def test_missing_cohort_never_falls_back_to_global():
    viewer = create_user()
    fact(viewer)
    data = live_ranking(viewer=viewer)
    assert data["cohort_required"] is True
    assert data["entries"] == []
    assert data["own_entry"] is None


def test_live_privacy_changes_apply_without_rebuilding_snapshots(cohort):
    viewer = create_user(cohort=cohort)
    peer = create_user(email="peer@test.com", full_name="Private Student", cohort=cohort)
    fact(viewer, 50)
    fact(peer, 100)
    data = live_ranking(viewer=viewer)
    assert data["entries"][0]["display_name"] == "P. S."
    assert data["points_to_next_rank"] == 50
    profile = RankingProfile.objects.create(user=peer, display_mode="anonymous")
    data = live_ranking(viewer=viewer)
    assert data["entries"][0]["display_name"].startswith("Learner ")
    assert "Private" not in str(data)
    profile.included = False
    profile.save()
    data = live_ranking(viewer=viewer)
    assert data["participant_count"] == 1
    assert data["own_entry"]["position"] == 1
    assert data["points_to_next_rank"] is None
    assert RankingFact.objects.filter(user=peer).count() == 1


def test_own_rank_beyond_top_100_and_shared_competition_positions(cohort):
    viewer = create_user(cohort=cohort)
    fact(viewer, 5)
    for n in range(101):
        peer = create_user(email=f"peer-{n}@test.com", cohort=cohort)
        fact(peer, 10)
    data = live_ranking(viewer=viewer)
    assert len(data["entries"]) == 100
    assert data["participant_count"] == 102
    assert data["own_entry"]["position"] == 102
    assert data["points_to_next_rank"] == 5
    assert all(row["position"] == 1 for row in data["entries"])


def test_calendar_boundaries_use_libya_not_utc():
    now = datetime(2026, 12, 31, 22, 30, tzinfo=UTC)  # January 1 in Libya.
    start, end = period_bounds(period="monthly", now=now)
    assert start.isoformat() == "2027-01-01T00:00:00+02:00"
    assert end.isoformat() == "2027-02-01T00:00:00+02:00"
    monday = datetime(2026, 10, 25, 22, 30, tzinfo=UTC)
    start, end = period_bounds(period="weekly", now=monday)
    assert start.isoformat() == "2026-10-26T00:00:00+02:00"
    assert end - start == timedelta(days=7)


def test_weekly_monthly_and_all_time_exclude_old_and_future_evidence(cohort, monkeypatch):
    now = datetime(2026, 10, 28, 12, tzinfo=UTC)
    monkeypatch.setattr("apps.rankings.live.timezone.now", lambda: now)
    viewer = create_user(cohort=cohort)
    start, _ = period_bounds(period="weekly", now=now)
    fact(viewer, 10, at=start)
    fact(viewer, 20, at=start - timedelta(microseconds=1))
    fact(viewer, 30, at=datetime(2026, 9, 30, 21, tzinfo=UTC))
    fact(viewer, 999, at=now + timedelta(seconds=1))
    assert live_ranking(viewer=viewer)["own_entry"]["score"] == 10
    assert live_ranking(viewer=viewer, period="monthly")["own_entry"]["score"] == 30
    assert live_ranking(viewer=viewer, period="all_time")["own_entry"]["score"] == 60


def test_live_api_requires_auth_validates_filters_and_rejects_score_writes(cohort):
    client = APIClient()
    assert client.get("/api/v1/progression/rankings/live").status_code in (401, 403)
    viewer = create_user(cohort=cohort)
    client.force_authenticate(viewer)
    fact(viewer)
    response = client.get("/api/v1/progression/rankings/live?period=weekly")
    assert response.status_code == 200
    assert response["Cache-Control"] == "private, no-store"
    assert response.json()["own_entry"]["score"] == 100
    assert client.get("/api/v1/progression/rankings/live?period=invalid").status_code == 400
    assert client.post("/api/v1/progression/rankings/live", {"score": 999}).status_code == 405
    hidden = client.put(
        "/api/v1/progression/rankings/profile",
        {"included": False, "display_mode": "anonymous"},
        format="json",
    )
    assert hidden.status_code == 200
    assert client.get("/api/v1/progression/rankings/live").json()["own_entry"] is None


def test_query_cost_is_bounded_as_cohort_grows(cohort, django_assert_num_queries):
    viewer = create_user(cohort=cohort)
    fact(viewer)
    for n in range(30):
        fact(create_user(email=f"budget-{n}@test.com", cohort=cohort), 200)
    with django_assert_num_queries(6, exact=False):
        live_ranking(viewer=viewer)


def test_changing_cohort_does_not_transfer_historical_xp(cohort):
    viewer = create_user(cohort=cohort)
    original = fact(viewer, 100)
    new_cohort = StudentCohort.objects.create(
        program=cohort.program, code="year-3", name_en="Year 3"
    )
    viewer.cohort = new_cohort
    viewer.save()
    assert live_ranking(viewer=viewer, period="all_time")["own_entry"] is None
    fact(viewer, 20)
    assert live_ranking(viewer=viewer, period="all_time")["own_entry"]["score"] == 20
    original.refresh_from_db()
    assert original.cohort_id == cohort.id


def test_legacy_backfill_anchors_existing_evidence_to_current_cohort(cohort):
    viewer = create_user(cohort=cohort)
    original = fact(viewer)
    RankingFact.objects.filter(pk=original.pk).update(cohort=None)
    migration = import_module("apps.rankings.migrations.0003_anchor_evidence_to_cohort")
    migration.backfill_cohorts(apps, SimpleNamespace(connection=connection))
    original.refresh_from_db()
    assert original.cohort_id == cohort.id


def test_opt_out_hides_previously_published_snapshot_entries(cohort):
    from apps.rankings.models import RankingDefinition
    from apps.rankings.selectors import current_ranking
    from apps.rankings.services import build_snapshot

    viewer = create_user(cohort=cohort)
    peer = create_user(email="historic@test.com", cohort=cohort)
    fact(viewer)
    fact(peer)
    build_snapshot(definition=RankingDefinition.objects.get(code="learning_all_time"))
    assert len(current_ranking(viewer=viewer)["entries"]) == 2
    RankingProfile.objects.create(user=peer, included=False)
    assert len(current_ranking(viewer=viewer)["entries"]) == 1

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
from django.db import close_old_connections
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user

from ..models import StudyPlanItem, StudyPlanProfile
from ..services import (
    PlanChanged,
    beginner_progress,
    generate_plan,
    plan_today,
    preview_plan,
    profile_for,
)
from .test_api import authenticated_client

pytestmark = pytest.mark.django_db


def config(**changes):
    return {
        "mode": "normal",
        "daily_minutes": 60,
        "session_minutes": 25,
        "weekdays": list(range(7)),
        "subjects": ["Anatomy", "Physiology"],
        "timezone": "Africa/Tripoli",
        "expected_revision": 0,
        **changes,
    }


def setup_plan(**changes):
    user = create_user(with_trial=True)
    client = authenticated_client(user)
    response = client.patch("/api/v1/study-plan/profile", config(**changes), format="json")
    assert response.status_code == 200, response.data
    today = plan_today(profile_for(user))
    monday = today - timedelta(days=today.weekday())
    return user, client, today, monday


def preview(client, start):
    result = client.post(
        "/api/v1/study-plan/preview", {"start_date": start.isoformat()}, format="json"
    )
    assert result.status_code == 200, result.data
    return result.json()


def generate(client, start, token):
    return client.post(
        "/api/v1/study-plan/generate",
        {
            "start_date": start.isoformat(),
            "preview_token": token,
        },
        format="json",
    )


def test_profile_defaults_do_not_write_and_legacy_items_are_preserved():
    user = create_user(with_trial=True)
    client = authenticated_client(user)
    today = timezone.localdate()
    item = StudyPlanItem.objects.create(user=user, title="Legacy", scheduled_date=today)
    result = client.get(f"/api/v1/study-plan?from={today}&to={today}")
    assert result.status_code == 200
    assert result.json()["profile"]["configured"] is False
    assert not StudyPlanProfile.objects.exists()
    assert (
        client.patch(
            "/api/v1/study-plan/profile", config(mode="beginning"), format="json"
        ).status_code
        == 200
    )
    item.refresh_from_db()
    assert item.title == "Legacy" and item.status == "planned"


@pytest.mark.parametrize(
    "change",
    [
        {"weekdays": []},
        {"weekdays": [0, 0]},
        {"weekdays": [7]},
        {"timezone": "Bad/Zone"},
        {"daily_minutes": 241},
        {"session_minutes": 0},
        {"subjects": ["A", "a"]},
        {"subjects": [" "]},
        {"mode": "admin"},
        {"user": "someone-else"},
    ],
)
def test_configuration_validation(change):
    user = create_user(with_trial=True)
    response = authenticated_client(user).patch(
        "/api/v1/study-plan/profile", config(**change), format="json"
    )
    assert response.status_code == 400
    assert not StudyPlanProfile.objects.exists()


def test_normal_preview_budget_past_dates_and_duplicate_generation():
    user, client, today, monday = setup_plan()
    StudyPlanItem.objects.create(
        user=user, title="Manual", scheduled_date=today, duration_minutes=15
    )
    proposed = preview(client, monday)
    dates = sorted({item["scheduled_date"] for item in proposed["items"]})
    assert dates[0] == today.isoformat()
    assert all(item["subject"] in ["Anatomy", "Physiology"] for item in proposed["items"])
    assert (
        sum(
            item["duration_minutes"]
            for item in proposed["items"]
            if item["scheduled_date"] == str(today)
        )
        == 45
    )
    assert generate(client, monday, proposed["preview_token"]).status_code == 200
    count = StudyPlanItem.objects.count()
    assert generate(client, monday, proposed["preview_token"]).status_code == 409
    empty = preview(client, monday)
    assert empty["count"] == 0
    assert generate(client, monday, empty["preview_token"]).json()["count"] == 0
    assert StudyPlanItem.objects.count() == count


def test_preview_becomes_stale_after_settings_or_manual_task_changes():
    user, client, today, monday = setup_plan()
    proposed = preview(client, monday)
    StudyPlanItem.objects.create(user=user, title="New task", scheduled_date=today)
    assert generate(client, monday, proposed["preview_token"]).status_code == 409
    proposed = preview(client, monday)
    response = client.patch(
        "/api/v1/study-plan/profile", config(expected_revision=1, daily_minutes=90), format="json"
    )
    assert response.status_code == 200
    assert generate(client, monday, proposed["preview_token"]).status_code == 409
    assert (
        client.patch(
            "/api/v1/study-plan/profile", config(expected_revision=1), format="json"
        ).status_code
        == 409
    )


def test_beginning_counts_distinct_days_and_does_not_reset_for_missed_days():
    user, client, today, monday = setup_plan(mode="beginning")
    for days in [1, 1, 5, 12]:
        StudyPlanItem.objects.create(
            user=user,
            title="Done",
            scheduled_date=today - timedelta(days=days),
            status="completed",
            plan_mode="beginning",
            completed_at=timezone.now(),
        )
    progress = beginner_progress(user, today)
    assert progress["completed_days"] == 3
    assert progress["session_minutes"] == 15
    assert all(item["duration_minutes"] == 15 for item in preview(client, monday)["items"])
    for days in range(20, 29):
        StudyPlanItem.objects.create(
            user=user,
            title="Done",
            scheduled_date=today - timedelta(days=days),
            status="completed",
            plan_mode="beginning",
        )
    assert beginner_progress(user, today)["ready_for_normal"] is True


def test_item_revision_future_completion_and_idempotent_timestamp():
    user, client, today, _monday = setup_plan()
    item = StudyPlanItem.objects.create(user=user, title="Today", scheduled_date=today)
    path = f"/api/v1/study-plan/items/{item.id}"
    completed = client.patch(path, {"status": "completed", "expected_revision": 1}, format="json")
    assert completed.status_code == 200
    repeated = client.patch(path, {"status": "completed", "expected_revision": 2}, format="json")
    assert repeated.json()["completed_at"] == completed.json()["completed_at"]
    assert (
        client.patch(path, {"title": "Stale", "expected_revision": 1}, format="json").status_code
        == 409
    )
    assert client.delete(path + "?revision=1").status_code == 409
    assert (
        client.patch(
            path, {"scheduled_date": str(today + timedelta(days=1))}, format="json"
        ).status_code
        == 400
    )
    assert client.patch(path, {"status": "planned"}, format="json").json()["completed_at"] is None


def test_manual_retry_daily_limit_and_account_isolation():
    user, client, today, monday = setup_plan(mode="custom")
    body = {
        "title": "Private",
        "scheduled_date": str(today),
        "duration_minutes": 480,
        "client_request_id": str(uuid4()),
    }
    first = client.post("/api/v1/study-plan/items", body, format="json")
    second = client.post("/api/v1/study-plan/items", body, format="json")
    assert first.json()["id"] == second.json()["id"]
    assert StudyPlanItem.objects.filter(user=user).count() == 1
    assert (
        client.post(
            "/api/v1/study-plan/items", {**body, "client_request_id": str(uuid4())}, format="json"
        ).status_code
        == 400
    )
    stranger = authenticated_client(create_user(email="stranger@example.test", with_trial=True))
    assert stranger.delete(f"/api/v1/study-plan/items/{first.json()['id']}").status_code == 404
    result = stranger.get(f"/api/v1/study-plan?from={today}&to={today}").json()
    assert result["profile"]["revision"] == 0 and result["count"] == 0
    assert (
        client.post(
            "/api/v1/study-plan/preview", {"start_date": str(monday)}, format="json"
        ).status_code
        == 400
    )


def test_legacy_day_over_the_cap_still_allows_completion_but_not_growth():
    user, client, today, _monday = setup_plan(mode="custom")
    items = [
        StudyPlanItem.objects.create(
            user=user, title=f"Legacy {index}", scheduled_date=today, duration_minutes=300
        )
        for index in range(2)
    ]
    path = f"/api/v1/study-plan/items/{items[0].id}"
    completed = client.patch(path, {"status": "completed", "expected_revision": 1}, format="json")
    assert completed.status_code == 200, completed.data
    assert client.patch(path, {"duration_minutes": 200}, format="json").status_code == 200
    assert client.patch(path, {"duration_minutes": 250}, format="json").status_code == 400


def test_writes_require_authentication_subscription_and_csrf():
    assert APIClient().patch("/api/v1/study-plan/profile", config(), format="json").status_code in (
        401,
        403,
    )
    user = create_user(with_trial=True)
    csrf = APIClient(enforce_csrf_checks=True)
    csrf.force_login(user)
    assert csrf.patch("/api/v1/study-plan/profile", config(), format="json").status_code == 403
    expired = authenticated_client(create_user(email="expired@example.test", verified=False))
    assert expired.patch("/api/v1/study-plan/profile", config(), format="json").status_code == 403


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_concurrent_generation_serializes_on_the_account():
    user = create_user(verified=False)
    fields = config()
    fields.pop("expected_revision")
    profile = StudyPlanProfile.objects.create(user=user, **fields)
    today = plan_today(profile)
    monday = today - timedelta(days=today.weekday())
    token = preview_plan(user, monday)["preview_token"]
    barrier = Barrier(2)

    def worker():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            try:
                generate_plan(user, monday, token)
                return 200
            except PlanChanged:
                return 409
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: worker(), range(2)))
    assert sorted(results) == [200, 409]
    items = StudyPlanItem.objects.filter(user=user, generated_slot__isnull=False)
    assert items.count() > 0
    assert items.values("scheduled_date", "generated_slot").distinct().count() == items.count()


def test_generated_session_can_move_to_a_day_with_the_same_slot():
    user, client, today, _monday = setup_plan(mode="beginning")
    source = StudyPlanItem.objects.create(
        user=user, title="Move me", scheduled_date=today, generated_slot=0, plan_mode="beginning"
    )
    target = today + timedelta(days=1)
    StudyPlanItem.objects.create(
        user=user,
        title="Already here",
        scheduled_date=target,
        generated_slot=0,
        plan_mode="beginning",
    )
    response = client.patch(
        f"/api/v1/study-plan/items/{source.id}",
        {
            "scheduled_date": str(target),
            "expected_revision": source.revision,
        },
        format="json",
    )
    assert response.status_code == 200
    assert StudyPlanItem.objects.filter(user=user, scheduled_date=target).count() == 2
    source.refresh_from_db()
    assert source.generated_slot is None and source.plan_mode == "beginning"


def test_real_cookie_session_can_save_preview_and_complete_with_rotated_csrf():
    from apps.accounts.tests.helpers import PASSWORD

    create_user(email="session-plan@example.test", with_trial=True)
    client = APIClient(enforce_csrf_checks=True)
    token = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    logged_in = client.post(
        "/api/v1/auth/login",
        {
            "email": "session-plan@example.test",
            "password": PASSWORD,
            "remember_me": False,
        },
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert logged_in.status_code == 200
    token = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    client.credentials(HTTP_X_CSRFTOKEN=token)
    saved = client.patch("/api/v1/study-plan/profile", config(mode="beginning"), format="json")
    assert saved.status_code == 200
    user = StudyPlanProfile.objects.get().user
    today = plan_today(profile_for(user))
    monday = today - timedelta(days=today.weekday())
    proposed = preview(client, monday)
    created = generate(client, monday, proposed["preview_token"])
    assert created.status_code == 200 and created.json()["count"] > 0
    identifier = created.json()["results"][0]["id"]
    completed = client.patch(
        f"/api/v1/study-plan/items/{identifier}",
        {
            "status": "completed",
            "expected_revision": 1,
        },
        format="json",
    )
    assert completed.status_code == 200
    assert completed.json()["completed_at"] is not None
    assert (
        client.get(f"/api/v1/study-plan?from={today}&to={today}").json()["summary"][
            "completed_count"
        ]
        == 1
    )


def test_account_timezone_controls_today_and_future_completion(monkeypatch):
    from datetime import datetime

    monkeypatch.setattr(
        "apps.study_plans.services.timezone.now",
        lambda: datetime(2026, 10, 25, 22, 30, tzinfo=UTC),
    )
    # The trial must exist on the same clock as the protected requests below.
    user, client, _today, _monday = setup_plan()
    item = StudyPlanItem.objects.create(user=user, title="Monday", scheduled_date="2026-10-26")
    path = f"/api/v1/study-plan/items/{item.id}"
    query = "/api/v1/study-plan?from=2026-10-25&to=2026-10-26"
    assert client.get(query).json()["today"] == "2026-10-26"
    assert client.patch(path, {"status": "completed"}, format="json").status_code == 200
    assert client.patch(path, {"status": "planned"}, format="json").status_code == 200
    changed = client.patch(
        "/api/v1/study-plan/profile",
        config(timezone="America/Los_Angeles", expected_revision=1),
        format="json",
    )
    assert changed.status_code == 200
    assert client.get(query).json()["today"] == "2026-10-25"
    assert client.patch(path, {"status": "completed"}, format="json").status_code == 400


def test_expired_access_blocks_plan_reads_and_writes_without_deleting_work():
    from apps.entitlements.models import EntitlementGrant
    from apps.subscriptions.models import Subscription

    user = create_user(with_trial=True)
    item = StudyPlanItem.objects.create(
        user=user, title="Retained work", scheduled_date=timezone.localdate()
    )
    Subscription.objects.filter(account__primary_user=user).update(status="expired")
    EntitlementGrant.objects.filter(user=user).update(status="expired")
    client = authenticated_client(user)
    today = timezone.localdate()
    assert client.get(f"/api/v1/study-plan?from={today}&to={today}").status_code == 403
    assert client.patch("/api/v1/study-plan/profile", config(), format="json").status_code == 403
    assert not StudyPlanProfile.objects.filter(user=user).exists()
    assert StudyPlanItem.objects.filter(pk=item.pk).exists()


def test_browser_timezone_alias_works_without_system_timezone_files():
    import zoneinfo
    from unittest.mock import patch

    user = create_user(with_trial=True)
    client = authenticated_client(user)
    original = zoneinfo.TZPATH
    zoneinfo.reset_tzpath(())
    try:
        with patch("apps.study_plans.serializers.ZoneInfo", zoneinfo.ZoneInfo.no_cache):
            saved = client.patch(
                "/api/v1/study-plan/profile", config(timezone="Asia/Calcutta"), format="json"
            )
        assert saved.status_code == 200, saved.data
        with patch("apps.study_plans.services.ZoneInfo", zoneinfo.ZoneInfo.no_cache):
            today = plan_today(profile_for(user))
            assert client.get(f"/api/v1/study-plan?from={today}&to={today}").status_code == 200
    finally:
        zoneinfo.reset_tzpath(original)

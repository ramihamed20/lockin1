from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.accounts.tests.helpers import create_user
from apps.accounts.tests.test_avatars import avatar_upload
from apps.content.models import LearningObjectVersion
from apps.focus.leaderboard import rankings
from apps.focus.models import ActiveStudyAttempt, ActiveStudyRun, FocusSession, FocusSessionActivity
from apps.focus.services import create_focus_team

from .test_lock_in import _client, _fixture, _grant

pytestmark = pytest.mark.django_db


def session(user, *, team=None, seconds=3600):
    end = timezone.now() - timedelta(minutes=1)
    return FocusSession.objects.create(
        user=user,
        team=team,
        status="completed",
        started_at=end - timedelta(hours=3),
        ended_at=end,
        active_duration_seconds=seconds,
    )


def attempt(user, version_id, at, *, number=1, score=18, total=20, run=None):
    if run is None:
        run = ActiveStudyRun.objects.create(
            user=user,
            sheet_id=LearningObjectVersion.objects.get(pk=version_id).learning_object_id,
            material_slug="test",
            sheet_slug="test",
            difficulty="medium",
            page_count=1,
        )
    return ActiveStudyAttempt.objects.create(
        run=run,
        kind="final",
        number=number,
        score=score,
        total=total,
        passed=score >= total * 0.6,
        submitted_at=at,
    )


def test_completed_windows_and_distinct_sheets():
    user, version = _fixture()
    saved = session(user, team=create_focus_team(user=user, name="Team"))
    first = attempt(user, version, saved.ended_at - timedelta(minutes=2))
    attempt(user, version, saved.ended_at - timedelta(minutes=1), run=first.run, number=2)
    attempt(user, version, saved.ended_at + timedelta(seconds=1), run=first.run, number=3, score=0)
    row = rankings(period="weekly", metric="sheets", cohort_id=None)["teams"][0]
    assert row["completed_sheets"] == 1
    assert row["answered_count"] == 40
    assert row["accuracy_percent"] == 90
    assert row["active_seconds"] == 3600


def test_accuracy_minimum_weighted_answers_and_period():
    user, version = _fixture()
    saved = session(user)
    first = attempt(user, version, saved.ended_at - timedelta(minutes=1), total=1, score=1)
    assert rankings(period="weekly", metric="accuracy", cohort_id=None)["solo"] == []
    attempt(
        user,
        version,
        saved.ended_at - timedelta(minutes=1),
        total=20,
        score=10,
        run=first.run,
        number=2,
    )
    row = rankings(period="weekly", metric="accuracy", cohort_id=None)["solo"][0]
    assert row["accuracy_percent"] == 52.4
    FocusSession.objects.filter(pk=saved.pk).update(
        ended_at=timezone.now() - timedelta(days=10), started_at=timezone.now() - timedelta(days=11)
    )
    assert rankings(period="weekly", metric="time", cohort_id=None)["solo"] == []


def test_longest_continuous_focus_excludes_breaks():
    a = create_user(email="breaks@example.com", full_name="Breaks")
    b = create_user(email="continuous@example.com", full_name="Continuous")
    for user, segments in [(a, [0, 30, 40, 70]), (b, [0, 40])]:
        saved = session(user)
        kinds = (
            ["started", "completed"] if user == b else ["started", "paused", "resumed", "completed"]
        )
        for index, minute in enumerate(segments):
            FocusSessionActivity.objects.create(
                session=saved,
                sequence=index + 1,
                activity_type=kinds[index],
                occurred_at=saved.started_at + timedelta(minutes=minute),
            )
    rows = rankings(period="weekly", metric="continuous", cohort_id=None)["solo"]
    assert rows[0]["name"] == "Continuous"
    assert [row["longest_focus_seconds"] for row in rows] == [2400, 1800]


def test_anonymous_zero_time_has_no_accuracy_or_avatar():
    user = create_user(email="hidden@example.com", full_name="Never expose this")
    saved = session(user, seconds=0)
    FocusSession.objects.filter(pk=saved.pk).update(anonymous=True)
    row = rankings(period="weekly", metric="time", cohort_id=None)["solo"][0]
    assert row["anonymous"] is True
    assert row["name"].startswith("Anonymous ")
    assert row["avatar"] is None
    assert row["accuracy_percent"] is None
    assert user.full_name not in str(row)


def test_query_count_is_bounded():
    user = create_user(email="first@example.com")
    session(user)
    with CaptureQueriesContext(connection) as small:
        rankings(period="weekly", metric="time", cohort_id=None)
    for index in range(12):
        other = create_user(email=f"rank-{index}@example.com")
        session(other, team=create_focus_team(user=other, name=f"Team {index}"))
    with CaptureQueriesContext(connection) as large:
        rankings(period="weekly", metric="time", cohort_id=None)
    assert len(small) == len(large) == 2


def test_only_host_uploads_a_valid_team_image(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    user = create_user(email="image-host@example.com")
    guest = create_user(email="image-guest@example.com")
    _grant(user)
    _grant(guest)
    team = create_focus_team(user=user, name="Photo team")
    url = f"/api/v1/focus/lock-in/teams/{team.id}/image"
    assert (
        _client(guest).post(url, {"file": avatar_upload()}, format="multipart").status_code == 403
    )
    response = _client(user).post(url, {"file": avatar_upload()}, format="multipart")
    assert response.status_code == 201
    team.refresh_from_db()
    assert response.json()["team"]["image_url"] == f"/api/v1/files/{team.image_id}/view"
    assert _client(guest).get(response.json()["team"]["image_url"]).status_code == 200
    invalid = SimpleUploadedFile("fake.png", b"not an image", content_type="image/png")
    assert _client(user).post(url, {"file": invalid}, format="multipart").status_code == 400
    old = team.image_id
    team.refresh_from_db()
    assert team.image_id == old

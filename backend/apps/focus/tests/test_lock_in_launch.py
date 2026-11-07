from datetime import timedelta
from uuid import uuid4

import pytest
from django.test import override_settings
from django.utils import timezone

from apps.focus.models import FocusSession, FocusSessionParticipant, FocusTeamMembership
from apps.focus.selectors import get_focus_summary
from apps.focus.views import _team_rankings_payload

from .test_lock_in_live import BASE, account

pytestmark = pytest.mark.django_db


def start(client, team_id=None):
    response = client.post(
        BASE,
        {
            "client_instance_id": str(uuid4()),
            "experience_version": 2,
            "session_type": "timed",
            "planned_duration_seconds": 1500,
            **({"team_id": team_id} if team_id else {}),
        },
        format="json",
    )
    assert response.status_code == 201, response.json()
    return response.json()["session"]["id"]


def test_gate_blocks_new_work_but_keeps_existing_session_recoverable():
    _, client = account("launch-gate@example.com")
    session_id = start(client)
    with override_settings(LOCKIN_MODE_ENABLED=False, LOCKIN_MODE_PILOT_USER_IDS=()):
        availability = client.get(f"{BASE}/availability").json()
        assert availability == {"enabled": False, "active_session_id": session_id}
        assert client.post(BASE, {}, format="json").status_code == 403
        assert client.get(f"{BASE}/{session_id}").status_code == 200
        assert client.post(f"{BASE}/{session_id}/complete", {}, format="json").status_code == 200


def test_membership_is_not_attendance_and_break_rejoin_does_not_double_time(monkeypatch):
    _, host = account("ledger-host@example.com")
    student, member = account("ledger-member@example.com")
    team = host.post(f"{BASE}/teams", {"name": "Study"}, format="json").json()["team"]
    member.post(f"{BASE}/teams/join", {"invite_code": team["invite_code"]}, format="json")
    now = timezone.now()
    monkeypatch.setattr(timezone, "now", lambda: now)
    sid = start(host, team["id"])
    assert member.get(BASE).json()["active_session"] is None
    now += timedelta(seconds=10)
    assert (
        member.post(f"{BASE}/teams/{team['id']}/join-session", {}, format="json").status_code == 200
    )
    now += timedelta(seconds=20)
    member.post(f"{BASE}/{sid}/presence", {"presence": "break"}, format="json")
    now += timedelta(seconds=10)
    member.post(f"{BASE}/{sid}/presence", {"presence": "focused"}, format="json")
    now += timedelta(seconds=10)
    member.post(f"{BASE}/{sid}/leave-session", {}, format="json")
    now += timedelta(seconds=10)
    member.post(f"{BASE}/teams/{team['id']}/join-session", {}, format="json")
    now += timedelta(seconds=10)
    assert host.post(f"{BASE}/{sid}/complete", {}, format="json").status_code == 200
    row = FocusSessionParticipant.objects.get(session_id=sid, user=student)
    assert row.active_microseconds // 1_000_000 == 40
    assert get_focus_summary(user_id=student.id).active_seconds == 40
    assert host.post(f"{BASE}/{sid}/complete", {}, format="json").status_code == 200
    row.refresh_from_db()
    assert row.active_microseconds // 1_000_000 == 40


def test_disconnected_client_cannot_accrue_more_than_grace(monkeypatch):
    user, host = account("grace-host@example.com")
    team = host.post(f"{BASE}/teams", {"name": "Study"}, format="json").json()["team"]
    sid = start(host, team["id"])
    session = FocusSession.objects.get(id=sid)
    monkeypatch.setattr(timezone, "now", lambda: session.started_at + timedelta(hours=3))
    response = host.get(f"{BASE}/{sid}").json()
    assert response["session"]["status"] == "completed"
    assert response["self_active_seconds"] == 75
    assert get_focus_summary(user_id=user.id).active_seconds == 75
    assert FocusSession.objects.get(id=sid).ended_at == session.deadline_at


def test_notes_are_private_and_stale_revision_is_rejected():
    _, host = account("note-host@example.com")
    _, member = account("note-member@example.com")
    team = host.post(f"{BASE}/teams", {"name": "Study"}, format="json").json()["team"]
    member.post(f"{BASE}/teams/join", {"invite_code": team["invite_code"]}, format="json")
    sid = start(host, team["id"])
    member.post(f"{BASE}/teams/{team['id']}/join-session", {}, format="json")
    saved = member.patch(
        f"{BASE}/{sid}/note", {"body": "private text", "expected_revision": 1}, format="json"
    )
    assert saved.status_code == 200, saved.json()
    assert saved.json()["note"]["body"] == "private text"
    assert "private text" not in str(host.get(f"{BASE}/{sid}").json())
    assert (
        member.patch(
            f"{BASE}/{sid}/note", {"body": "overwrite", "expected_revision": 1}, format="json"
        ).status_code
        == 400
    )


def test_invite_attempt_window_and_expiry():
    _, client = account("limit@example.com")
    for _ in range(10):
        assert (
            client.post(f"{BASE}/teams/join", {"invite_code": "000000"}, format="json").status_code
            == 400
        )
    assert (
        client.post(f"{BASE}/teams/join", {"invite_code": "000000"}, format="json").status_code
        == 429
    )


def test_rankings_do_not_multiply_equal_sessions_by_members():
    owner, client = account("rank-owner@example.com")
    team = client.post(f"{BASE}/teams", {"name": "Rank"}, format="json").json()["team"]
    other, _ = account("rank-other@example.com")
    FocusTeamMembership.objects.create(team_id=team["id"], user=other)
    for _ in range(2):
        FocusSession.objects.create(
            user=owner,
            team_id=team["id"],
            status="completed",
            started_at=timezone.now() - timedelta(seconds=1500),
            ended_at=timezone.now(),
            active_duration_seconds=1500,
        )
    assert _team_rankings_payload()[0]["weekly_active_seconds"] == 3000

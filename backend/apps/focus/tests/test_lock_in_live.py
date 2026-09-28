from uuid import uuid4

import pytest
from django.utils import timezone

from apps.accounts.tests.helpers import create_user
from apps.focus.models import FocusSession, FocusSessionParticipant

from .test_lock_in import _client, _grant

pytestmark = pytest.mark.django_db
BASE = "/api/v1/focus/lock-in"


def account(email):
    user = create_user(email=email)
    _grant(user)
    return user, _client(user)


def start(client, team_id=None):
    return client.post(
        BASE,
        {
            "client_instance_id": str(uuid4()),
            "session_type": "timed",
            "planned_duration_seconds": 1500,
            **({"team_id": team_id} if team_id else {}),
        },
        format="json",
    )


def test_solo_live_timer_break_pause_resume_and_summary() -> None:
    user, client = account("live-solo@example.com")
    started = start(client)
    assert started.status_code == 201
    payload = started.json()
    session_id = payload["session"]["id"]
    assert payload["session"]["lock_in_live"] is True
    assert payload["timing"]["server_now"]
    assert client.get(BASE).json()["active_session"]["session"]["id"] == session_id
    assert start(client).json()["session"]["id"] == session_id
    assert (
        client.post(f"{BASE}/{session_id}/start-break", {}, format="json").json()["session"][
            "status"
        ]
        == "on_break"
    )
    assert (
        client.post(f"{BASE}/{session_id}/end-break", {}, format="json").json()["session"]["status"]
        == "active"
    )
    assert (
        client.post(f"{BASE}/{session_id}/pause", {}, format="json").json()["session"]["status"]
        == "paused"
    )
    assert (
        client.post(f"{BASE}/{session_id}/resume", {}, format="json").json()["session"]["status"]
        == "active"
    )
    completed = client.post(f"{BASE}/{session_id}/complete", {}, format="json")
    assert completed.status_code == 200
    assert completed.json()["session"]["ended_at"]
    assert completed.json()["session"]["status"] == "completed"
    assert client.get(BASE).json()["active_session"] is None
    assert FocusSession.objects.get(pk=session_id).user_id == user.id


def test_team_shared_session_presence_privacy_leave_and_host_end() -> None:
    host_user, host = account("live-host@example.com")
    private_user, member = account("live-private@example.com")
    private_user.full_name = "Private Member Name"
    private_user.save(update_fields=("full_name",))
    _, other = account("live-late@example.com")
    team = host.post(f"{BASE}/teams", {"name": "Quiet team"}, format="json").json()["team"]
    member.post(
        f"{BASE}/teams/join",
        {
            "invite_code": team["invite_code"],
            "anonymous": True,
        },
        format="json",
    )
    assert start(member, team["id"]).status_code == 400

    started = start(host, team["id"])
    assert started.status_code == 201
    session_id = started.json()["session"]["id"]
    assert started.json()["is_host"] is True
    assert start(host, team["id"]).json()["session"]["id"] == session_id
    member_payload = member.get(BASE).json()["active_session"]
    assert member_payload["session"]["id"] == session_id
    assert member_payload["is_host"] is False
    assert member_payload["participants"][1]["name"] == "Anonymous 01"
    assert private_user.full_name not in str(member_payload)
    assert str(private_user.id) not in str(member_payload)
    assert member_payload.get("note") is None
    assert member_payload.get("tasks") is None

    assert (
        member.post(f"{BASE}/{session_id}/presence", {"presence": "break"}, format="json").json()[
            "self_presence"
        ]
        == "break"
    )
    assert host.get(f"{BASE}/{session_id}").json()["participants"][1]["presence"] == "break"
    assert (
        member.post(f"{BASE}/{session_id}/presence", {"presence": "focused"}, format="json").json()[
            "self_presence"
        ]
        == "focused"
    )
    assert (
        member.post(f"{BASE}/{session_id}/presence", {"presence": "away"}, format="json").json()[
            "self_presence"
        ]
        == "away"
    )
    assert member.post(f"{BASE}/{session_id}/complete", {}, format="json").status_code == 400
    assert host.post(f"{BASE}/{session_id}/pause", {}, format="json").status_code == 400

    late_join = other.post(
        f"{BASE}/teams/join", {"invite_code": team["invite_code"]}, format="json"
    )
    assert late_join.status_code == 200
    assert other.get(BASE).json()["active_session"]["session"]["id"] == session_id
    assert (
        member.post(f"{BASE}/{session_id}/leave-session", {}, format="json").json()["left"] is True
    )
    assert member.get(BASE).json()["active_session"] is None
    assert member.get(f"{BASE}/{session_id}").status_code == 400
    assert (
        member.post(f"{BASE}/teams/{team['id']}/join-session", {}, format="json").json()["session"][
            "id"
        ]
        == session_id
    )

    completed = host.post(f"{BASE}/{session_id}/complete", {}, format="json")
    assert completed.status_code == 200
    assert completed.json()["session"]["status"] == "completed"
    assert other.get(f"{BASE}/{session_id}").json()["session"]["status"] == "completed"
    assert FocusSessionParticipant.objects.filter(session_id=session_id).count() == 3
    assert FocusSession.objects.get(pk=session_id).user_id == host_user.id


def test_kick_and_host_transfer_apply_during_live_session() -> None:
    _, host = account("live-host-transfer@example.com")
    _, member = account("live-member-transfer@example.com")
    team = host.post(f"{BASE}/teams", {"name": "Transfer"}, format="json").json()["team"]
    joined = member.post(
        f"{BASE}/teams/join",
        {
            "invite_code": team["invite_code"],
            "anonymous": True,
        },
        format="json",
    ).json()["team"]
    member_id = joined["members"][1]["member_id"]
    session_id = start(host, team["id"]).json()["session"]["id"]
    assert (
        host.post(
            f"{BASE}/teams/{team['id']}/transfer-host",
            {
                "member_id": member_id,
            },
            format="json",
        ).status_code
        == 200
    )
    assert host.post(f"{BASE}/{session_id}/complete", {}, format="json").status_code == 400
    assert member.post(f"{BASE}/{session_id}/complete", {}, format="json").status_code == 200
    assert timezone.now() >= FocusSession.objects.get(pk=session_id).ended_at

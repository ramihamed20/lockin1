import re

import pytest

from apps.accounts.tests.helpers import create_user
from apps.focus.models import FocusTeam, FocusTeamMembership
from apps.focus.services import create_focus_team

from .test_lock_in import _client, _fixture, _grant, _start

pytestmark = pytest.mark.django_db
BASE = "/api/v1/focus/lock-in/teams"


def account(email):
    user = create_user(email=email)
    _grant(user)
    return user, _client(user)


def test_create_join_capacity_lock_and_anonymous_payload() -> None:
    owner, host = account("lobby-host@example.com")
    member, guest = account("lobby-guest@example.com")
    outsider, outside = account("lobby-outside@example.com")
    created = host.post(
        BASE, {"name": "Quiet team", "max_members": 2, "anonymous": True}, format="json"
    )
    assert created.status_code == 201
    team = created.json()["team"]
    assert re.fullmatch(r"[0-9]{6}", team["invite_code"])
    assert team["members"][0]["name"] == "Anonymous 01"
    assert team["members"][0]["user_id"] is None
    assert str(owner.id) not in str(team["members"])

    joined = guest.post(
        f"{BASE}/join", {"invite_code": team["invite_code"], "anonymous": True}, format="json"
    )
    assert joined.status_code == 200
    members = joined.json()["team"]["members"]
    assert [item["name"] for item in members] == ["Anonymous 01", "Anonymous 02"]
    assert all(item["user_id"] is None for item in members)
    assert member.full_name not in str(joined.json())
    assert (
        outside.post(
            f"{BASE}/join", {"invite_code": team["invite_code"]}, format="json"
        ).status_code
        == 400
    )
    assert host.patch(f"{BASE}/{team['id']}", {"max_members": 1}, format="json").status_code == 400

    removed_id = members[1]["member_id"]
    assert (
        guest.patch(f"{BASE}/{team['id']}", {"name": "Not allowed"}, format="json").status_code
        == 400
    )
    assert (
        host.post(f"{BASE}/{team['id']}/kick", {"member_id": removed_id}, format="json").status_code
        == 200
    )
    assert guest.get(f"{BASE}/{team['id']}").status_code == 400
    assert (
        host.patch(f"{BASE}/{team['id']}", {"joining_locked": True}, format="json").status_code
        == 200
    )
    assert (
        outside.post(
            f"{BASE}/join", {"invite_code": team["invite_code"]}, format="json"
        ).status_code
        == 400
    )
    assert (
        host.patch(f"{BASE}/{team['id']}", {"joining_locked": False}, format="json").status_code
        == 200
    )
    assert (
        outside.post(
            f"{BASE}/join", {"invite_code": team["invite_code"]}, format="json"
        ).status_code
        == 200
    )


def test_code_regeneration_transfer_and_host_leave() -> None:
    owner, host = account("lobby-owner2@example.com")
    member, guest = account("lobby-member2@example.com")
    created = host.post(BASE, {"name": "Alpha"}, format="json").json()["team"]
    old_code = created["invite_code"]
    joined = guest.post(f"{BASE}/join", {"invite_code": old_code}, format="json").json()["team"]
    member_id = next(
        item["member_id"] for item in joined["members"] if item["user_id"] == str(member.id)
    )
    refreshed = host.post(f"{BASE}/{created['id']}/regenerate-code", {}, format="json").json()[
        "team"
    ]
    assert refreshed["invite_code"] != old_code
    assert (
        guest.post(f"{BASE}/{created['id']}/regenerate-code", {}, format="json").status_code == 400
    )
    assert guest.post(f"{BASE}/join", {"invite_code": old_code}, format="json").status_code == 400
    assert guest.post(f"{BASE}/{created['id']}/end", {}, format="json").status_code == 400
    assert (
        host.post(
            f"{BASE}/{created['id']}/transfer-host", {"member_id": member_id}, format="json"
        ).status_code
        == 200
    )
    assert FocusTeam.objects.get(pk=created["id"]).owner_id == member.id
    assert host.post(f"{BASE}/{created['id']}/end", {}, format="json").status_code == 400
    assert guest.post(f"{BASE}/{created['id']}/leave", {}, format="json").status_code == 200
    assert FocusTeam.objects.get(pk=created["id"]).owner_id == owner.id
    assert FocusTeamMembership.objects.filter(team_id=created["id"]).count() == 1
    assert host.post(f"{BASE}/{created['id']}/end", {}, format="json").status_code == 200
    assert (
        host.post(
            f"{BASE}/{created['id']}/messages", {"body": "Too late"}, format="json"
        ).status_code
        == 400
    )
    _, client = account("lobby-newcomer@example.com")
    assert (
        client.post(
            f"{BASE}/join", {"invite_code": refreshed["invite_code"]}, format="json"
        ).status_code
        == 400
    )


def test_collision_uses_another_code(monkeypatch) -> None:
    owner, _ = account("lobby-collision1@example.com")
    other, _ = account("lobby-collision2@example.com")
    sequence = iter(["123456", "123456", "654321"])
    monkeypatch.setattr("apps.focus.services.focus_team_invite_code", lambda: next(sequence))
    first = create_focus_team(user=owner, name="First")
    second = create_focus_team(user=other, name="Second")
    assert first.invite_code == "123456"
    assert second.invite_code == "654321"


def test_anonymous_message_stays_private_after_kick() -> None:
    _, host = account("lobby-message-host@example.com")
    member, guest = account("lobby-message-guest@example.com")
    team = host.post(BASE, {"name": "Private"}, format="json").json()["team"]
    guest.post(
        f"{BASE}/join", {"invite_code": team["invite_code"], "anonymous": True}, format="json"
    )
    guest.post(f"{BASE}/{team['id']}/messages", {"body": "Hello"}, format="json")
    member_id = FocusTeamMembership.objects.get(team_id=team["id"], user=member).id
    host.post(f"{BASE}/{team['id']}/kick", {"member_id": str(member_id)}, format="json")
    messages = host.get(f"{BASE}/{team['id']}/messages").json()["messages"]
    assert messages[0]["author_name"] == "Anonymous 01"
    assert messages[0]["author_id"] == str(member_id)
    assert member.full_name not in str(messages)


def test_anonymous_solo_session_hides_name_on_lockin_leaderboard() -> None:
    student, version_id = _fixture()
    student.full_name = "Private Student"
    student.save(update_fields=("full_name",))
    client = _client(student)
    prior = _start(client, version_id)
    assert client.post(
        f"/api/v1/focus/lock-in/{prior.json()['session']['id']}/complete", {}, format="json"
    ).status_code == 200
    started = _start(client, version_id, anonymous=True)
    assert started.status_code == 201
    assert started.json()["session"]["anonymous"] is True
    leaderboard = client.get("/api/v1/focus/lock-in/leaderboard").json()
    assert leaderboard["solo"][0]["name"].startswith("Anonymous ")
    assert "Private Student" not in str(leaderboard)

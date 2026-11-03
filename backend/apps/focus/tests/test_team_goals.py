from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.focus.models import FocusSession, FocusSessionParticipant

from .test_lock_in_launch import start
from .test_lock_in_live import BASE, account

pytestmark = pytest.mark.django_db


def room():
    host_user, host = account("goal-host@example.com")
    member_user, member = account("goal-member@example.com")
    member_user.full_name = "Secret Student"
    member_user.save(update_fields=("full_name",))
    team = host.post(f"{BASE}/teams", {"name": "Study"}, format="json").json()["team"]
    member.post(
        f"{BASE}/teams/join", {"invite_code": team["invite_code"], "anonymous": True}, format="json"
    )
    sid = start(host, team["id"])
    return host_user, host, member_user, member, team, sid


def put(client, sid, pages=10, done=8, revision=1, **extra):
    return client.put(
        f"{BASE}/{sid}/goal",
        {"goal_pages": pages, "completed_pages": done, "expected_revision": revision, **extra},
        format="json",
    )


def test_self_goal_shared_with_team_without_private_identity_or_credit():
    host_user, host, member_user, member, team, sid = room()
    member.post(f"{BASE}/teams/{team['id']}/join-session", {}, format="json")
    assert put(member, sid).status_code == 200
    projection = host.get(f"{BASE}/{sid}").json()
    public = projection["participants"][1]
    assert public["name"] == "Anonymous 01"
    assert public["goal"] == {"pages": 10, "completed": 8, "revision": 2}
    assert member_user.full_name not in str(projection)
    assert str(member_user.id) not in str(projection)
    own = FocusSessionParticipant.objects.get(session_id=sid, user=host_user)
    assert own.goal_pages is None and own.completed_pages == 0
    member_row = FocusSessionParticipant.objects.get(session_id=sid, user=member_user)
    assert member_row.active_microseconds == 0
    assert member_row.credited_at is None
    assert put(member, sid, done=10, revision=2).status_code == 200
    assert host.get(f"{BASE}/{sid}").json()["participants"][1]["goal"]["completed"] == 10
    assert put(member, sid, pages=None, done=0, revision=3).status_code == 200


def test_authority_requires_entitlement_membership_and_active_attendance():
    _, host, _, member, team, sid = room()
    _, outsider = account("goal-outsider@example.com")
    assert put(APIClient(), sid).status_code in (401, 403)
    assert put(outsider, sid).status_code == 400
    assert put(member, sid).status_code == 400  # Membership alone is not attendance.
    member.post(f"{BASE}/teams/{team['id']}/join-session", {}, format="json")
    # A host cannot select another participant through this self-only contract.
    assert put(host, sid, member_id=team["self_member_id"]).status_code == 400
    assert put(member, sid).status_code == 200
    member.post(f"{BASE}/{sid}/leave-session", {}, format="json")
    assert put(member, sid, done=9, revision=2).status_code == 400
    member.post(f"{BASE}/teams/{team['id']}/join-session", {}, format="json")
    assert put(member, sid, done=9, revision=2).status_code == 200
    host.post(f"{BASE}/{sid}/complete", {}, format="json")
    assert put(member, sid, done=10, revision=3).status_code == 400


def test_retry_and_stale_tab_do_not_overwrite_progress():
    user, host, _, _, _, sid = room()
    assert put(host, sid).status_code == 200
    first = FocusSession.objects.get(id=sid).revision
    assert put(host, sid).status_code == 200  # Lost acknowledgement retry.
    assert FocusSession.objects.get(id=sid).revision == first
    assert put(host, sid, done=9).status_code == 409
    assert FocusSessionParticipant.objects.get(session_id=sid, user=user).completed_pages == 8
    assert put(host, sid, done=9, revision=2).status_code == 200


@pytest.mark.parametrize("pages,done", [(0, 0), (10001, 0), (5, 6), (None, 1), (10, -1)])
def test_invalid_progress_is_rejected(pages, done):
    _, host, _, _, _, sid = room()
    assert put(host, sid, pages=pages, done=done).status_code == 400


def test_expired_session_cannot_update_goal(monkeypatch):
    _, host, _, _, _, sid = room()
    deadline = FocusSession.objects.get(id=sid).deadline_at
    monkeypatch.setattr(timezone, "now", lambda: deadline + timedelta(seconds=1))
    assert put(host, sid).status_code == 400


@pytest.mark.parametrize("pages,done", [(None, 1), (3, 4), (0, 0), (10001, 0)])
def test_database_rejects_invalid_goal_rows(pages, done):
    user, _, _, _, _, sid = room()
    with pytest.raises(IntegrityError), transaction.atomic():
        FocusSessionParticipant.objects.filter(session_id=sid, user=user).update(
            goal_pages=pages, completed_pages=done
        )

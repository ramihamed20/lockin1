from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.db import close_old_connections
from django.utils import timezone

from apps.accounts.models import User
from apps.focus.models import FocusTeam, FocusTeamInvitation, FocusTeamMembership
from apps.focus.services import (
    FocusTeamLimitError,
    create_focus_team,
    join_focus_team,
)
from apps.focus.team_invitations import invite_friend

from .test_social import account, become_friends

pytestmark = pytest.mark.django_db
BASE = "/api/v1/focus/lock-in/teams"


def assert_limit(response):
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "focus_team_limit_reached"


def test_owned_and_joined_teams_share_three_slots_and_leave_frees_one():
    user, client = account("limited")
    host, _ = account("host")
    own = create_focus_team(user=user, name="Owned")
    targets = [create_focus_team(user=host, name=f"Other {n}") for n in range(3)]
    for team in targets[:2]:
        assert (
            client.post(
                f"{BASE}/join", {"invite_code": team.invite_code}, format="json"
            ).status_code
            == 200
        )
    count = FocusTeam.objects.count()
    assert_limit(client.post(BASE, {"name": "Fourth"}, format="json"))
    assert FocusTeam.objects.count() == count
    assert_limit(
        client.post(f"{BASE}/join", {"invite_code": targets[2].invite_code}, format="json")
    )
    assert FocusTeamMembership.objects.filter(user=user).count() == 3
    assert client.post(f"{BASE}/{own.pk}/leave", {}, format="json").status_code == 200
    assert (
        client.post(
            f"{BASE}/join", {"invite_code": targets[2].invite_code}, format="json"
        ).status_code
        == 200
    )
    assert FocusTeamMembership.objects.filter(user=user, team__closed_at__isnull=True).count() == 3


def test_direct_acceptance_obeys_limit_and_ended_teams_do_not_count():
    user, client = account("limited")
    host, _ = account("host")
    become_friends(user, host)
    old = [create_focus_team(user=user, name=f"Owned {n}") for n in range(3)]
    target = create_focus_team(user=host, name="Invited")
    invitation = invite_friend(user=host, team_id=target.pk, peer_id=user.pk)
    url = f"/api/v1/focus/lock-in/invitations/{invitation.pk}/accept"
    assert_limit(client.post(url, {}, format="json"))
    invitation.refresh_from_db()
    assert invitation.status == "pending"
    assert not FocusTeamMembership.objects.filter(team=target, user=user).exists()
    assert client.post(f"{BASE}/{old[0].pk}/end", {}, format="json").status_code == 200
    assert client.post(url, {}, format="json").status_code == 200
    assert client.post(url, {}, format="json").status_code == 200
    assert FocusTeamMembership.objects.filter(user=user, team__closed_at__isnull=True).count() == 3
    assert FocusTeamMembership.objects.filter(user=user).count() == 4


def test_limit_does_not_block_declining_or_remove_legacy_memberships():
    user, client = account("limited")
    host, _ = account("host")
    become_friends(user, host)
    teams = [create_focus_team(user=user, name=f"Owned {n}") for n in range(3)]
    extra = create_focus_team(user=host, name="Legacy")
    FocusTeamMembership.objects.create(team=extra, user=user)
    assert_limit(client.post(BASE, {"name": "More"}, format="json"))
    assert FocusTeamMembership.objects.filter(user=user).count() == 4
    invitation = FocusTeamInvitation.objects.create(team=extra, sender=host, recipient=user)
    assert (
        client.post(
            f"/api/v1/focus/lock-in/invitations/{invitation.pk}/decline", {}, format="json"
        ).status_code
        == 200
    )
    # Closing a team leaves historical membership untouched and releases its slot.
    FocusTeam.objects.filter(pk__in=[team.pk for team in teams[:2]]).update(
        closed_at=timezone.now()
    )
    assert client.post(BASE, {"name": "New"}, format="json").status_code == 201


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("kinds", [("join", "join"), ("create", "join"), ("create", "create")])
def test_concurrent_additions_cannot_both_take_the_last_slot(kinds):
    user, _ = account("race_member")
    host, _ = account("race_host")
    for index in range(2):
        create_focus_team(user=user, name=f"Existing {index}")
    targets = [create_focus_team(user=host, name=f"Target {index}") for index in range(2)]
    barrier = Barrier(2)

    def add(index):
        close_old_connections()
        try:
            member = User.objects.get(pk=user.pk)
            barrier.wait(timeout=10)
            try:
                if kinds[index] == "create":
                    create_focus_team(user=member, name=f"Created {index}")
                else:
                    join_focus_team(user=member, invite_code=targets[index].invite_code)
                return "added"
            except FocusTeamLimitError:
                return "limited"
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(add, index) for index in range(2)]
        results = [future.result(timeout=20) for future in futures]
    assert sorted(results) == ["added", "limited"]
    assert FocusTeamMembership.objects.filter(user=user, team__closed_at__isnull=True).count() == 3

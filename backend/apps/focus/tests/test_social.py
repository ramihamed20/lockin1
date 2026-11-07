from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.friends import are_friends, friends_payload, request_friend, respond_friend
from apps.accounts.models import AccountSession, Friendship
from apps.accounts.tests.helpers import create_user
from apps.focus.models import FocusTeamInvitation, FocusTeamMembership
from apps.focus.services import create_focus_team, join_focus_team
from apps.focus.team_invitations import invite_friend, respond_invitation
from apps.notifications.models import Notification

from .test_lock_in import _client, _grant

pytestmark = pytest.mark.django_db


def account(label):
    user = create_user(email=f"{label}@example.com", username=label, full_name=label)
    _grant(user)
    return user, _client(user)


def become_friends(first, second):
    link = request_friend(user=first, peer_id=second.pk)
    respond_friend(user=second, request_id=link.pk, action="accept")
    return link


def test_friend_requests_are_mutual_idempotent_and_private():
    a, client = account("alice")
    b, guest = account("bob")
    stranger, outside = account("eve")
    url = "/api/v1/account/friends/requests"
    assert client.post(url, {"user_id": str(b.pk)}, format="json").status_code == 201
    assert client.post(url, {"user_id": str(b.pk)}, format="json").status_code == 201
    assert Friendship.objects.count() == 1
    assert Notification.objects.filter(template_key="friends.request", recipient=b).count() == 1
    assert friends_payload(a)["friends"] == []
    incoming = guest.get("/api/v1/account/friends").json()["incoming"][0]
    request_id = incoming["request_id"]
    assert "email" not in incoming and "online" not in incoming
    assert outside.post(f"{url}/{request_id}/accept", {}, format="json").status_code == 404
    assert client.post(f"{url}/{request_id}/accept", {}, format="json").status_code == 403
    assert guest.post(f"{url}/{request_id}/accept", {}, format="json").status_code == 200
    assert are_friends(a, b)
    assert client.get("/api/v1/account/friends").json()["friends"][0]["id"] == str(b.pk)
    assert stranger.email not in str(friends_payload(a))
    AccountSession.objects.create(
        user=b,
        session_key="bob-active",
        device_label="Private device",
        expires_at=timezone.now() + timedelta(hours=1),
    )
    friend = friends_payload(a)["friends"][0]
    assert friend["online"] is True
    assert "last_seen_at" not in friend and "Private device" not in str(friend)


def test_search_is_exact_username_and_self_inactive_private_data_are_hidden():
    a, client = account("alice")
    b, _ = account("bob")
    base = "/api/v1/account/friends/search"
    assert client.get(base, {"username": "bo"}).json()["users"] == []
    assert client.get(base, {"username": "alice"}).json()["users"] == []
    result = client.get(base, {"username": "@bob"}).json()["users"][0]
    assert result["id"] == str(b.pk)
    assert "email" not in result and "online" not in result
    b.status = "suspended"
    b.save(update_fields=("status",))
    assert client.get(base, {"username": "bob"}).json()["users"] == []
    assert APIClient().get("/api/v1/account/friends").status_code in {401, 403}
    assert (
        client.post(
            "/api/v1/account/friends/requests", {"user_id": str(a.pk)}, format="json"
        ).status_code
        == 400
    )


def test_decline_has_cooldown_and_withdrawn_friendship_blocks_team_invites():
    a, _ = account("alice")
    b, _ = account("bob")
    link = request_friend(user=a, peer_id=b.pk)
    respond_friend(user=b, request_id=link.pk, action="decline")
    from rest_framework.exceptions import PermissionDenied, ValidationError

    with pytest.raises(ValidationError):
        request_friend(user=a, peer_id=b.pk)
    Friendship.objects.filter(pk=link.pk).update(updated_at=timezone.now() - timedelta(days=2))
    link = become_friends(a, b)
    team = create_focus_team(user=a, name="Study")
    invitation = invite_friend(user=a, team_id=team.pk, peer_id=b.pk)
    respond_friend(user=a, request_id=link.pk, action="remove")
    with pytest.raises(PermissionDenied):
        respond_invitation(user=b, invitation_id=invitation.pk, action="accept")
    assert not FocusTeamMembership.objects.filter(team=team, user=b).exists()


def test_only_host_invites_accepted_friends_and_only_recipient_joins():
    a, host = account("alice")
    b, guest = account("bob")
    c, outside = account("eve")
    team = create_focus_team(user=a, name="Study")
    url = f"/api/v1/focus/lock-in/teams/{team.pk}/invitations"
    assert host.post(url, {"user_id": str(b.pk)}, format="json").status_code == 403
    become_friends(a, b)
    assert outside.post(url, {"user_id": str(b.pk)}, format="json").status_code == 403
    assert host.post(url, {"user_id": str(b.pk)}, format="json").status_code == 201
    assert host.post(url, {"user_id": str(b.pk)}, format="json").status_code == 201
    invitation = FocusTeamInvitation.objects.get()
    assert (
        Notification.objects.filter(template_key="focus.team_invitation", recipient=b).count() == 1
    )
    assert not FocusTeamMembership.objects.filter(team=team, user=b).exists()
    incoming = guest.get("/api/v1/focus/lock-in/invitations").json()["incoming"]
    assert incoming[0]["team_name"] == "Study"
    accept = f"/api/v1/focus/lock-in/invitations/{invitation.pk}/accept"
    assert outside.post(accept, {}, format="json").status_code == 404
    assert guest.post(accept, {}, format="json").status_code == 200
    assert guest.post(accept, {}, format="json").status_code == 200
    assert FocusTeamMembership.objects.filter(team=team, user=b).count() == 1
    assert c.pk != b.pk


def test_acceptance_rechecks_capacity_lock_and_expiry():
    from rest_framework.exceptions import ValidationError

    a, _ = account("alice")
    b, _ = account("bob")
    c, _ = account("eve")
    become_friends(a, b)
    team = create_focus_team(user=a, name="Study", max_members=2)
    invitation = invite_friend(user=a, team_id=team.pk, peer_id=b.pk)
    team.joining_locked = True
    team.save(update_fields=("joining_locked",))
    with pytest.raises(ValidationError):
        respond_invitation(user=b, invitation_id=invitation.pk, action="accept")
    team.joining_locked = False
    team.save(update_fields=("joining_locked",))
    join_focus_team(user=c, invite_code=team.invite_code)
    with pytest.raises(ValidationError):
        respond_invitation(user=b, invitation_id=invitation.pk, action="accept")
    FocusTeamMembership.objects.filter(team=team, user=c).delete()
    FocusTeamInvitation.objects.filter(pk=invitation.pk).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    with pytest.raises(ValidationError):
        respond_invitation(user=b, invitation_id=invitation.pk, action="accept")


def test_direct_invitation_does_not_renew_expired_public_code():
    from apps.focus.services import FocusSessionStateError

    a, _ = account("alice")
    b, _ = account("bob")
    c, _ = account("eve")
    become_friends(a, b)
    team = create_focus_team(user=a, name="Study")
    team.invite_expires_at = timezone.now() - timedelta(days=1)
    team.save(update_fields=("invite_expires_at",))
    invitation = invite_friend(user=a, team_id=team.pk, peer_id=b.pk)
    with pytest.raises(FocusSessionStateError):
        join_focus_team(user=c, invite_code=team.invite_code)
    assert respond_invitation(user=b, invitation_id=invitation.pk, action="accept").pk == team.pk
    with pytest.raises(FocusSessionStateError):
        join_focus_team(user=c, invite_code=team.invite_code, direct_invitation_id=uuid4())

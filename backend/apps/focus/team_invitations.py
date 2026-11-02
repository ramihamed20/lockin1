"""Direct team invitations reuse the existing join/capacity/cohort rules."""

from datetime import timedelta
from uuid import UUID

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.accounts.friends import are_friends, links, person
from apps.accounts.models import User
from apps.notifications.services import create_notification

from .models import FocusTeam, FocusTeamInvitation, FocusTeamMembership
from .services import FocusSessionStateError, join_focus_team


def invitation_payload(user: User) -> dict[str, object]:
    accepted = links(user).filter(status="accepted")
    friend_ids = set(accepted.values_list("first_id", flat=True)) | set(
        accepted.values_list("second_id", flat=True)
    )
    incoming = (
        FocusTeamInvitation.objects.filter(
            recipient=user,
            status="pending",
            expires_at__gt=timezone.now(),
            team__closed_at__isnull=True,
            sender_id=F("team__owner_id"),
            sender_id__in=friend_ids,
            sender__is_active=True,
            sender__status="active",
        )
        .select_related("team", "sender")
        .order_by("-created_at")[:100]
    )
    sent = FocusTeamInvitation.objects.filter(
        team__owner=user,
        status="pending",
        expires_at__gt=timezone.now(),
        team__closed_at__isnull=True,
    ).order_by("-created_at")[:200]
    return {
        "incoming": [
            {
                "id": str(item.pk),
                "team_id": str(item.team_id),
                "team_name": item.team.name,
                "image_url": f"/api/v1/files/{item.team.image_id}/view"
                if item.team.image_id
                else None,
                "sender": person(item.sender),
            }
            for item in incoming
        ],
        "sent": [
            {"team_id": str(item.team_id), "user_id": str(item.recipient_id)} for item in sent
        ],
    }


@transaction.atomic
def invite_friend(*, user: User, team_id: UUID, peer_id: UUID) -> FocusTeamInvitation:
    team = (
        FocusTeam.objects.select_for_update()
        .filter(pk=team_id, owner=user, closed_at__isnull=True)
        .first()
    )
    if team is None:
        raise PermissionDenied("Only the host can invite friends.")
    people = list(
        User.objects.select_for_update()
        .filter(pk__in=(user.pk, peer_id), is_active=True, status="active")
        .order_by("pk")
    )
    peer = next((item for item in people if item.pk == peer_id), None)
    if len(people) != 2 or peer is None or not are_friends(user, peer):
        raise PermissionDenied("Invite an accepted friend.")
    if team.cohort_id and team.cohort_id != peer.cohort_id:
        raise ValidationError("This team is not available to that account.")
    if (
        team.joining_locked
        or FocusTeamMembership.objects.filter(team=team).count() >= team.max_members
    ):
        raise ValidationError("This team is not accepting members.")
    old = FocusTeamInvitation.objects.filter(team=team, recipient=peer).first()
    now = timezone.now()
    if old and old.sender_id == user.pk and old.status == "pending" and old.expires_at > now:
        return old
    if old and old.status == "declined" and old.updated_at > now - timedelta(days=1):
        raise ValidationError("Wait before inviting this friend again.")
    if (
        FocusTeamInvitation.objects.filter(
            sender=user, updated_at__gte=now - timedelta(minutes=10)
        ).count()
        >= 20
    ):
        raise ValidationError("Too many invitations. Try later.")
    if old:
        old.sender = user
        old.status = "pending"
        old.expires_at = now + timedelta(days=1)
        old.save(update_fields=("sender", "status", "expires_at", "updated_at"))
        invitation = old
    else:
        invitation = FocusTeamInvitation.objects.create(team=team, sender=user, recipient=peer)
    ar = peer.preferred_language == "ar"
    create_notification(
        recipient_id=peer.pk,
        actor_id=user.pk,
        category="community",
        template_key="focus.team_invitation",
        title="دعوة لفريق" if ar else "Team invitation",
        body=team.name,
        target_route="/lock-in",
        data={"invitation_id": str(invitation.pk)},
        deduplication_key=f"team-invite:{invitation.pk}:{invitation.updated_at.isoformat()}",
    )
    return invitation


@transaction.atomic
def respond_invitation(*, user: User, invitation_id: UUID, action: str) -> FocusTeam | None:
    hint = FocusTeamInvitation.objects.filter(pk=invitation_id, recipient=user).first()
    if hint is None:
        raise NotFound("Invitation unavailable.")
    team = FocusTeam.objects.select_for_update().get(pk=hint.team_id)
    list(User.objects.select_for_update().filter(pk__in=(user.pk, hint.sender_id)).order_by("pk"))
    invitation = (
        FocusTeamInvitation.objects.select_for_update().select_related("sender").get(pk=hint.pk)
    )
    if (
        not user.is_active
        or user.status != "active"
        or not invitation.sender.is_active
        or invitation.sender.status != "active"
    ):
        raise PermissionDenied()
    if (
        action == "accept"
        and invitation.status == "accepted"
        and FocusTeamMembership.objects.filter(team=team, user=user).exists()
    ):
        return team
    if invitation.status != "pending" or invitation.expires_at <= timezone.now() or team.closed_at:
        raise ValidationError("Invitation expired or unavailable.")
    if action == "decline":
        invitation.status = "declined"
        invitation.save(update_fields=("status", "updated_at"))
        return None
    if (
        action != "accept"
        or team.owner_id != invitation.sender_id
        or not are_friends(user, invitation.sender)
    ):
        raise PermissionDenied()
    if not FocusTeamMembership.objects.filter(team=team, user=user).exists():
        try:
            team, _ = join_focus_team(
                user=user, invite_code=team.invite_code, direct_invitation_id=invitation.pk
            )
        except FocusSessionStateError as error:
            raise ValidationError(str(error)) from error
    invitation.status = "accepted"
    invitation.save(update_fields=("status", "updated_at"))
    return team

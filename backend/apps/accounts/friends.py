"""Mutual friendships. Private account/contact/device fields never leave this boundary."""

from datetime import timedelta
from uuid import UUID

from django.db import transaction
from django.db.models import Q, QuerySet
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from .avatars import avatar_payload
from .models import AccountSession, Friendship, User


def links(user: User) -> QuerySet[Friendship]:
    return Friendship.objects.filter(Q(first=user) | Q(second=user))


def are_friends(first: User, second: User) -> bool:
    low, high = sorted((first.pk, second.pk))
    return Friendship.objects.filter(first_id=low, second_id=high, status="accepted").exists()


def person(user: User) -> dict[str, object]:
    return {
        "id": str(user.pk),
        "name": user.full_name or user.username or "Student",
        "username": user.username,
        "avatar": avatar_payload(user),
    }


def friends_payload(user: User) -> dict[str, object]:
    records = list(
        links(user)
        .exclude(status="declined")
        .select_related("first", "second")
        .order_by("-updated_at")[:250]
    )
    peers = {row.pk: row.second if row.first_id == user.pk else row.first for row in records}
    active_ids = {peer.pk for peer in peers.values() if peer.is_active and peer.status == "active"}
    online = set(
        AccountSession.objects.filter(
            user_id__in=active_ids,
            expires_at__gt=timezone.now(),
            last_seen_at__gte=timezone.now() - timedelta(minutes=6),
        ).values_list("user_id", flat=True)
    )
    result: dict[str, list[dict[str, object]]] = {"friends": [], "incoming": [], "outgoing": []}
    for row in records:
        peer = peers[row.pk]
        if peer.pk not in active_ids:
            continue
        data = {**person(peer), "request_id": str(row.pk)}
        if row.status == "accepted":
            data["online"] = peer.pk in online
            result["friends"].append(data)
        else:
            result["outgoing" if row.requested_by_id == user.pk else "incoming"].append(data)
    result["friends"].sort(key=lambda item: (not item["online"], str(item["name"]).casefold()))
    return {key: value for key, value in result.items()}


def notify_friend(
    *, recipient: User, actor: User, link: Friendship, accepted: bool = False
) -> None:
    from apps.notifications.services import create_notification

    ar = recipient.preferred_language == "ar"
    event = "accepted" if accepted else "request"
    create_notification(
        recipient_id=recipient.pk,
        actor_id=actor.pk,
        category="community",
        template_key="friends.accepted" if accepted else "friends.request",
        title=("تم قبول الصداقة" if accepted else "طلب صداقة")
        if ar
        else ("Friend request accepted" if accepted else "Friend request"),
        body=actor.full_name or actor.username or "Student",
        deduplication_key=f"friend:{link.pk}:{link.updated_at.isoformat()}:{event}",
        target_route="/lock-in",
        data={"friendship_id": str(link.pk)},
    )


@transaction.atomic
def request_friend(*, user: User, peer_id: UUID) -> Friendship:
    if user.pk == peer_id:
        raise ValidationError({"user_id": "Choose another student."})
    people = list(
        User.objects.select_for_update()
        .filter(pk__in=(user.pk, peer_id), is_active=True, status="active")
        .order_by("pk")
    )
    if len(people) != 2:
        raise NotFound("Student unavailable.")
    peer = next(item for item in people if item.pk == peer_id)
    low, high = sorted((user.pk, peer_id))
    existing = Friendship.objects.filter(first_id=low, second_id=high).first()
    if existing and existing.status in {"pending", "accepted"}:
        return existing
    if existing and existing.updated_at > timezone.now() - timedelta(days=1):
        raise ValidationError({"user_id": "Wait before sending another request."})
    for candidate in (user, peer):
        if links(candidate).exclude(status="declined").count() >= 200:
            raise ValidationError({"user_id": "Friend list limit reached."})
    if (
        Friendship.objects.filter(
            requested_by=user, updated_at__gte=timezone.now() - timedelta(minutes=10)
        ).count()
        >= 20
    ):
        raise ValidationError({"user_id": "Too many friend requests. Try later."})
    if existing:
        existing.requested_by = user
        existing.status = "pending"
        existing.save(update_fields=("requested_by", "status", "updated_at"))
        link = existing
    else:
        link = Friendship.objects.create(first_id=low, second_id=high, requested_by=user)
    notify_friend(recipient=peer, actor=user, link=link)
    return link


@transaction.atomic
def respond_friend(*, user: User, request_id: UUID, action: str) -> None:
    if action not in {"accept", "decline", "cancel", "remove"}:
        raise PermissionDenied()
    # All friendship mutations lock the same two account rows in canonical order.
    hint = links(user).filter(pk=request_id).first()
    if hint is None:
        raise NotFound("Request unavailable.")
    list(
        User.objects.select_for_update()
        .filter(pk__in=(hint.first_id, hint.second_id))
        .order_by("pk")
    )
    link = Friendship.objects.select_for_update().get(pk=hint.pk)
    is_sender = link.requested_by_id == user.pk
    if action == "remove":
        if link.status != "accepted":
            raise ValidationError("Friendship unavailable.")
    elif action == "cancel":
        if not is_sender or link.status != "pending":
            raise PermissionDenied()
    elif is_sender or link.status != "pending":
        raise PermissionDenied()
    link.status = "accepted" if action == "accept" else "declined"
    link.save(update_fields=("status", "updated_at"))
    if action == "accept":
        notify_friend(recipient=link.requested_by, actor=user, link=link, accepted=True)

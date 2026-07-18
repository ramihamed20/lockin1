from collections.abc import Iterable
from uuid import UUID

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.accounts.models import User
from apps.community.models import Discussion
from apps.community.selectors import discussion_for_user
from platform_core.events import publish_after_commit

from .events import NotificationCreated
from .models import Notification, NotificationCounter, NotificationDelivery, NotificationPreference


class NotificationTargetUnavailable(LookupError):
    pass


def _preference_allows(*, recipient: User, category: str, required: bool) -> bool:
    if required or category in (Notification.Category.ACCOUNT, Notification.Category.BILLING):
        return True
    preference = NotificationPreference.objects.filter(
        user=recipient,
        category=category,
        channel=NotificationPreference.Channel.IN_APP,
    ).first()
    return preference.enabled if preference else True


@transaction.atomic
def create_notification(
    *,
    recipient_id: UUID,
    category: str,
    template_key: str,
    title: str,
    body: str,
    deduplication_key: str,
    actor_id: UUID | None = None,
    data: dict[str, object] | None = None,
    target_type: str = "",
    target_id: UUID | None = None,
    target_route: str = "",
    required: bool = False,
) -> tuple[Notification | None, bool]:
    recipient = User.objects.get(id=recipient_id, is_active=True)
    if not _preference_allows(recipient=recipient, category=category, required=required):
        return None, False
    if target_route and (not target_route.startswith("/") or target_route.startswith("//")):
        raise ValueError("Notification routes must be safe application-relative paths.")
    counter, _ = NotificationCounter.objects.select_for_update().get_or_create(user=recipient)
    notification, created = Notification.objects.get_or_create(
        recipient=recipient,
        deduplication_key=deduplication_key,
        defaults={
            "actor_id": actor_id,
            "category": category,
            "template_key": template_key,
            "title": title,
            "body": body,
            "data": data or {},
            "target_type": target_type,
            "target_id": target_id,
            "target_route": target_route,
            "is_required": required,
        },
    )
    if not created:
        return notification, False
    NotificationDelivery.objects.create(
        notification=notification,
        channel=NotificationPreference.Channel.IN_APP,
        status=NotificationDelivery.Status.DELIVERED,
        delivered_at=timezone.now(),
    )
    counter.unread_count = F("unread_count") + 1
    counter.revision = F("revision") + 1
    counter.save(update_fields=("unread_count", "revision", "updated_at"))
    publish_after_commit(
        NotificationCreated(
            notification_id=notification.id,
            recipient_id=recipient.id,
            category=category,
        )
    )
    return notification, True


@transaction.atomic
def mark_read(*, user: User, notification_id: UUID) -> Notification:
    counter, _ = NotificationCounter.objects.select_for_update().get_or_create(user=user)
    notification = Notification.objects.select_for_update().get(id=notification_id, recipient=user)
    if notification.read_at is None:
        notification.read_at = timezone.now()
        notification.save(update_fields=("read_at",))
        counter.unread_count = max(counter.unread_count - 1, 0)
        counter.revision += 1
        counter.save()
    return notification


@transaction.atomic
def mark_all_read(*, user: User) -> int:
    counter, _ = NotificationCounter.objects.select_for_update().get_or_create(user=user)
    updated = Notification.objects.filter(recipient=user, read_at__isnull=True).update(
        read_at=timezone.now()
    )
    counter.unread_count = 0
    counter.revision += 1
    counter.save()
    return updated


def resolve_target(*, user: User, notification: Notification) -> str:
    if not notification.target_route:
        raise NotificationTargetUnavailable("This notification has no destination.")
    if notification.target_type == "discussion":
        if notification.target_id is None:
            raise NotificationTargetUnavailable("The discussion is no longer available.")
        try:
            discussion = discussion_for_user(user=user, discussion_id=notification.target_id)
        except Discussion.DoesNotExist as error:
            raise NotificationTargetUnavailable("The discussion is no longer available.") from error
        if discussion.status not in (Discussion.Status.ACTIVE, Discussion.Status.LOCKED):
            raise NotificationTargetUnavailable("The discussion is no longer available.")
    elif notification.target_type == "achievement":
        if notification.recipient_id != user.id:
            raise NotificationTargetUnavailable("This achievement is private.")
    return notification.target_route


def set_preferences(*, user: User, preferences: Iterable[dict[str, object]]) -> None:
    allowed_categories = set(Notification.Category.values)
    allowed_channels = set(NotificationPreference.Channel.values)
    with transaction.atomic():
        for item in preferences:
            category = str(item["category"])
            channel = str(item["channel"])
            enabled = bool(item["enabled"])
            if category not in allowed_categories or channel not in allowed_channels:
                raise ValueError("Unknown notification preference.")
            if (
                category in (Notification.Category.ACCOUNT, Notification.Category.BILLING)
                and not enabled
            ):
                raise ValueError("Required account and billing messages cannot be disabled.")
            NotificationPreference.objects.update_or_create(
                user=user,
                category=category,
                channel=channel,
                defaults={"enabled": enabled},
            )


def rebuild_counter(*, user: User) -> NotificationCounter:
    unread = Notification.objects.filter(recipient=user, read_at__isnull=True).count()
    counter, _ = NotificationCounter.objects.update_or_create(
        user=user, defaults={"unread_count": unread}
    )
    return counter

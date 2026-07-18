from django.db.models import QuerySet

from apps.accounts.models import User

from .models import Notification, NotificationCounter, NotificationPreference


def notifications_for_user(*, user: User, unread_only: bool = False) -> QuerySet[Notification]:
    queryset = Notification.objects.filter(recipient=user).select_related("actor")
    if unread_only:
        queryset = queryset.filter(read_at__isnull=True)
    return queryset.order_by("-created_at", "-id")


def unread_count(*, user: User) -> int:
    counter = NotificationCounter.objects.filter(user=user).first()
    return int(counter.unread_count) if counter else 0


def preferences_for_user(*, user: User) -> list[dict[str, object]]:
    saved = {
        (preference.category, preference.channel): preference.enabled
        for preference in NotificationPreference.objects.filter(user=user)
    }
    return [
        {
            "category": category,
            "channel": channel,
            "enabled": saved.get((category, channel), True),
            "required": category in (Notification.Category.ACCOUNT, Notification.Category.BILLING),
            "available": channel == NotificationPreference.Channel.IN_APP,
        }
        for category in Notification.Category.values
        for channel in NotificationPreference.Channel.values
    ]

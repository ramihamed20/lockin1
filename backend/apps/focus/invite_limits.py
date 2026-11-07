"""A cross-worker attempt window; cache eviction cannot reset this limit."""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import Throttled

from apps.accounts.models import User

from .models import FocusInviteWindow


def check_invite_attempt(user: User) -> None:
    with transaction.atomic():
        User.objects.select_for_update().get(id=user.id)
        window, _ = FocusInviteWindow.objects.get_or_create(user=user)
        now = timezone.now()
        if now >= window.started_at + timedelta(minutes=10):
            window.started_at = now
            window.attempts = 0
        allowed = window.attempts < 10
        window.attempts += int(allowed)
        window.save(update_fields=("attempts", "started_at"))
        wait = max(1, int((window.started_at + timedelta(minutes=10) - now).total_seconds()))
    if not allowed:
        raise Throttled(wait=wait)

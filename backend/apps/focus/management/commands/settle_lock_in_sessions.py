from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.focus.live_accounting import settle_expired_session
from apps.focus.models import FocusSession


class Command(BaseCommand):
    help = "Reconcile bounded live Lockin sessions at their server deadline."

    def handle(self, *args: object, **options: object) -> None:
        count = 0
        candidates = FocusSession.objects.filter(
            experience_version=2,
            lock_in_live=True,
            status="active",
            planned_duration_seconds__isnull=False,
            deadline_at__lte=timezone.now(),
        ).order_by("started_at")[:500]
        for session in candidates:
            if settle_expired_session(session).status == "completed":
                count += 1
        self.stdout.write(f"Settled {count} Lockin sessions.")

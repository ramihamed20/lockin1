from datetime import UTC, datetime

from django.core.management.base import BaseCommand, CommandParser
from django.utils import timezone

from apps.accounts.models import User

from ...models import BiweeklySnapshot
from ...services import create_snapshot, most_recent_closed


class Command(BaseCommand):
    help = (
        "Freeze each account's latest closed 14-day reports. "
        "--as-of permits an explicit historical backfill."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--as-of", type=str, help="UTC instant, e.g. 2026-10-13T00:00:00+00:00")
        parser.add_argument("--user-id", type=str)

    def handle(self, *args: object, **options: object) -> None:
        del args
        now = (
            datetime.fromisoformat(str(options["as_of"]))
            if options.get("as_of")
            else timezone.now()
        )
        if now.tzinfo is None:
            raise ValueError("--as-of must include a timezone offset.")
        if now > timezone.now():
            raise ValueError("--as-of cannot be in the future.")
        users = User.objects.order_by("id")
        if options.get("user_id"):
            users = users.filter(id=str(options["user_id"]))
        created = 0
        existing = 0
        for user in users.iterator(chunk_size=250):
            # Each account runs its own cycle; one still in its first period has nothing to close.
            period = most_recent_closed(user, now)
            if period is None:
                continue
            start, end = period
            for report_type in BiweeklySnapshot.Type.values:
                if BiweeklySnapshot.objects.filter(
                    user=user,
                    report_type=report_type,
                    period_start=start,
                ).exists():
                    existing += 1
                    continue
                if not options["dry_run"]:
                    create_snapshot(user=user, report_type=report_type, start=start, end=end)
                created += 1
        mode = "would create" if options["dry_run"] else "created"
        self.stdout.write(
            f"As of {now.astimezone(UTC).isoformat()}: {mode} {created}, existing {existing}."
        )

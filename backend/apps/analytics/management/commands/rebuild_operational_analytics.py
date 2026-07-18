from datetime import date
from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from apps.analytics.services import AnalyticsError, rebuild_daily_projections


class Command(BaseCommand):
    help = "Rebuild bounded daily analytics projections from durable analytics facts."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--from", dest="date_from", required=True)
        parser.add_argument("--to", dest="date_to", required=True)

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            start = date.fromisoformat(str(options["date_from"]))
            end = date.fromisoformat(str(options["date_to"]))
            result = rebuild_daily_projections(start=start, end=end)
        except (ValueError, AnalyticsError) as error:
            raise CommandError(str(error)) from error
        self.stdout.write(self.style.SUCCESS(f"Rebuilt projections: {result}"))

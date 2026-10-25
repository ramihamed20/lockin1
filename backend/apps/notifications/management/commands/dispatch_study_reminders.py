from django.core.management.base import BaseCommand, CommandParser

from apps.notifications.reminders import dispatch_study_reminders


class Command(BaseCommand):
    help = "Queue opted-in daily study reminders for the existing Web Push dispatcher."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--limit", type=int, default=100)

    def handle(self, *args: object, **options: object) -> None:
        self.stdout.write(str(dispatch_study_reminders(limit=int(str(options["limit"])))))

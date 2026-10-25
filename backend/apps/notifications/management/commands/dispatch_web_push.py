from django.core.management.base import BaseCommand, CommandParser

from apps.notifications.push import dispatch_push


class Command(BaseCommand):
    help = "Send queued device notifications; provider acceptance is not proof of display."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--limit", type=int, default=100)

    def handle(self, *args: object, **options: object) -> None:
        del args
        counts = dispatch_push(limit=int(str(options["limit"])))
        self.stdout.write(str(counts))

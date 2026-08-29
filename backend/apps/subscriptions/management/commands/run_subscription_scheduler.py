import signal
from threading import Event

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Run the lightweight subscription lifecycle scheduler process."

    def handle(self, *args: object, **options: object) -> None:
        stopped = Event()

        def stop(*args: object) -> None:
            stopped.set()

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        interval = max(
            60, int(getattr(settings, "SUBSCRIPTION_SCHEDULER_INTERVAL_SECONDS", 900))
        )
        self.stdout.write(f"Subscription scheduler running every {interval} seconds.")
        while not stopped.is_set():
            call_command("process_subscription_lifecycle")
            stopped.wait(interval)

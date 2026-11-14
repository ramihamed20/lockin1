from threading import Event
from typing import Any

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from apps.administration.automation import process_one_job


class Command(BaseCommand):
    help = "Process persistent administration jobs with one lightweight worker."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--once", action="store_true")

    def handle(self, *args: Any, **options: Any) -> None:
        if options["once"]:
            process_one_job()
            return
        stopped = Event()
        try:
            while not stopped.is_set():
                close_old_connections()
                if not process_one_job():
                    stopped.wait(5)
        except KeyboardInterrupt:
            stopped.set()

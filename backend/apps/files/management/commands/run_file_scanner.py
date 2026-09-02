import signal
from threading import Event

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.files.scanning import process_one_scan, recover_stale_scans


class Command(BaseCommand):
    help = "Run the bounded asynchronous managed-file malware scanner."

    def add_arguments(self, parser: object) -> None:
        parser.add_argument("--once", action="store_true")  # type: ignore[attr-defined]

    def handle(self, *args: object, **options: object) -> None:
        stopped = Event()

        def stop(*args: object) -> None:
            stopped.set()

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        interval = max(1, int(settings.FILE_SCAN_WORKER_INTERVAL_SECONDS))
        batch_size = max(1, int(settings.FILE_SCAN_BATCH_SIZE))
        run_once = bool(options["once"])
        self.stdout.write(
            f"File scanner running with batch size {batch_size} every {interval} seconds."
        )
        while not stopped.is_set():
            recovered = recover_stale_scans()
            processed = 0
            while processed < batch_size and process_one_scan():
                processed += 1
            if recovered or processed:
                self.stdout.write(f"Recovered {recovered}; processed {processed} file(s).")
            if run_once:
                return
            stopped.wait(interval)

"""Copy managed file objects from the local media root into object storage.

The stored object name never changes, so this command is re-runnable, needs no
database migration, and can be rolled back by pointing ``STORAGE_BACKEND`` at
the filesystem again while the local media root is still intact.
"""

import hashlib
import json
from argparse import ArgumentParser
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.files import File
from django.core.files.storage import FileSystemStorage, Storage, default_storage
from django.core.management import BaseCommand, CommandError

from apps.files.models import ManagedFile
from platform_core.storage import ManagedObjectUnavailable

COPY_CHUNK_BYTES = 1024 * 1024


class _Counters:
    def __init__(self) -> None:
        self.examined = 0
        self.copied = 0
        self.skipped_present = 0
        self.missing_source = 0
        self.missing_destination = 0
        self.unnamed = 0
        self.bytes_copied = 0
        self.verified = 0
        self.mismatched: list[str] = []

    def as_dict(self) -> dict[str, Any]:
        return {
            "examined": self.examined,
            "copied": self.copied,
            "skipped_present": self.skipped_present,
            "missing_source": self.missing_source,
            "missing_destination": self.missing_destination,
            "unnamed": self.unnamed,
            "bytes_copied": self.bytes_copied,
            "verified": self.verified,
            "mismatched": sorted(self.mismatched),
        }


def _checksum(handle: Any) -> str:
    digest = hashlib.sha256()
    while chunk := handle.read(COPY_CHUNK_BYTES):
        digest.update(chunk)
    return digest.hexdigest()


class Command(BaseCommand):
    help = "Copy managed files from the local media root into the configured object storage."

    # Re-runnable by construction: object names never change, an already present
    # object is skipped, and an interrupted run simply resumes where it stopped.

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument(
            "--media-root",
            default="",
            help="Source directory. Defaults to MEDIA_ROOT.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be copied without writing to the destination.",
        )
        parser.add_argument(
            "--overwrite",
            action="store_true",
            help="Replace destination objects that already exist.",
        )
        parser.add_argument(
            "--verify-checksum",
            action="store_true",
            help="Read each copied object back and compare its SHA-256 with the recorded value.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Stop after this many files. 0 processes every file.",
        )
        parser.add_argument(
            "--verify-only",
            action="store_true",
            help=(
                "Copy nothing. Confirm every recorded object is present in the destination and "
                "matches its SHA-256, which is the check to run after a full migration."
            ),
        )
        parser.add_argument(
            "--allow-filesystem-destination",
            action="store_true",
            help="Permit a filesystem destination, for rehearsing the copy locally.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        del args
        destination: Storage = default_storage
        if (
            isinstance(destination, FileSystemStorage)
            and not options["allow_filesystem_destination"]
        ):
            raise CommandError(
                "The configured default storage is the local filesystem. Set STORAGE_BACKEND=s3 "
                "and the STORAGE_* values before migrating, or pass "
                "--allow-filesystem-destination to rehearse."
            )
        media_root = Path(options["media_root"] or settings.MEDIA_ROOT)
        # Verification reads only the destination, so a source that has already
        # been decommissioned must not block it.
        if not options["verify_only"] and not media_root.is_dir():
            raise CommandError(f"The source media root {media_root} does not exist.")
        source = FileSystemStorage(location=str(media_root))

        counters = _Counters()
        limit = int(options["limit"])
        queryset = ManagedFile.objects.order_by("created_at").only(
            "id", "blob", "size_bytes", "checksum_sha256"
        )
        for managed_file in queryset.iterator(chunk_size=200):
            if limit and counters.examined >= limit:
                break
            counters.examined += 1
            self._migrate_one(
                managed_file=managed_file,
                source=source,
                destination=destination,
                counters=counters,
                options=options,
            )

        self.stdout.write(json.dumps({"status": "complete", **counters.as_dict()}, sort_keys=True))
        if counters.mismatched:
            raise CommandError(
                f"{len(counters.mismatched)} object(s) failed checksum verification."
            )
        if counters.missing_destination:
            raise CommandError(
                f"{counters.missing_destination} object(s) are missing from the destination."
            )

    def _migrate_one(
        self,
        *,
        managed_file: ManagedFile,
        source: FileSystemStorage,
        destination: Storage,
        counters: _Counters,
        options: dict[str, Any],
    ) -> None:
        name = managed_file.blob.name
        if not name:
            counters.unnamed += 1
            return
        if options["verify_only"]:
            if not destination.exists(name):
                counters.missing_destination += 1
                self.stderr.write(f"missing destination object for {managed_file.id}: {name}")
                return
            self._verify(managed_file=managed_file, destination=destination, counters=counters)
            return
        if not source.exists(name):
            counters.missing_source += 1
            self.stderr.write(f"missing source object for {managed_file.id}: {name}")
            return
        present = destination.exists(name)
        if present and not options["overwrite"]:
            counters.skipped_present += 1
            return
        if options["dry_run"]:
            counters.copied += 1
            counters.bytes_copied += managed_file.size_bytes
            return
        if present:
            destination.delete(name)
        with source.open(name, "rb") as handle:
            # save() streams the handle, so a multi-gigabyte set never has to be
            # held in memory or staged a second time on disk.
            written_name = destination.save(name, File(handle, name=name))
        if written_name != name:
            destination.delete(written_name)
            raise CommandError(
                f"The destination renamed {name} to {written_name}; refusing to diverge from the "
                "recorded object name."
            )
        counters.copied += 1
        counters.bytes_copied += managed_file.size_bytes
        if options["verify_checksum"]:
            self._verify(
                managed_file=managed_file,
                destination=destination,
                counters=counters,
            )

    def _verify(
        self,
        *,
        managed_file: ManagedFile,
        destination: Storage,
        counters: _Counters,
    ) -> None:
        name = managed_file.blob.name
        try:
            with destination.open(name, "rb") as handle:
                digest = _checksum(handle)
        except (OSError, ManagedObjectUnavailable) as error:
            counters.mismatched.append(str(managed_file.id))
            self.stderr.write(f"could not read back {managed_file.id}: {error}")
            return
        if digest != managed_file.checksum_sha256:
            counters.mismatched.append(str(managed_file.id))
            self.stderr.write(f"checksum mismatch for {managed_file.id}")
            return
        counters.verified += 1

"""Prove the configured object-storage provider satisfies the delivery contract.

This runs against whatever ``STORAGE_*`` names, so it is the staging gate for a
new provider (Cloudflare R2, MinIO, AWS S3, Backblaze B2) and stays free of any
provider-specific assumption. It writes one temporary object, exercises the
guarantees the private-file delivery path depends on, and removes it again.
"""

import hashlib
import json
import secrets
from argparse import ArgumentParser
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management import BaseCommand, CommandError

from platform_core.storage import ManagedObjectUnavailable, open_managed_object

# Large enough that a whole-object download is clearly distinguishable from a
# ranged read, small enough to stay cheap against a metered provider.
PROBE_BYTES = 5 * 1024 * 1024
RANGE_START = 1_048_576
RANGE_LENGTH = 65_536


class _StoredFile:
    """The minimal FieldFile surface open_managed_object needs."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.storage = default_storage


class Command(BaseCommand):
    help = "Round-trip a temporary object through the configured storage provider."

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument(
            "--prefix",
            default="storage-validation",
            help="Key prefix for the temporary probe object.",
        )
        parser.add_argument(
            "--skip-anonymous-check",
            action="store_true",
            help=(
                "Skip the unauthenticated fetch. Use only where the runner cannot reach the "
                "provider's public endpoint; the check is the point of the exercise otherwise."
            ),
        )
        parser.add_argument(
            "--keep",
            action="store_true",
            help="Leave the probe object in place for manual inspection.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        del args
        payload = secrets.token_bytes(PROBE_BYTES)
        checksum = hashlib.sha256(payload).hexdigest()
        name = f"{options['prefix'].strip('/')}/probe-{secrets.token_hex(8)}.bin"
        evidence: dict[str, Any] = {
            "backend": default_storage.__class__.__name__,
            "object": name,
            "size_bytes": len(payload),
        }

        stored_name = default_storage.save(name, ContentFile(payload))
        if stored_name != name:
            default_storage.delete(stored_name)
            raise CommandError(
                f"The provider renamed {name} to {stored_name}. Managed files are addressed by "
                "their recorded name, so silent renaming would orphan every row."
            )
        try:
            evidence.update(self._verify(name=name, payload=payload, checksum=checksum))
            if options["skip_anonymous_check"]:
                evidence["anonymous_access"] = "skipped"
            else:
                evidence["anonymous_access"] = self._verify_not_public(name)
        finally:
            if not options["keep"]:
                default_storage.delete(name)
                evidence["deleted"] = not default_storage.exists(name)

        if not options["keep"] and not evidence.get("deleted"):
            raise CommandError("The probe object still exists after deletion.")
        evidence["status"] = "ok"
        self.stdout.write(json.dumps(evidence, sort_keys=True))

    def _verify(self, *, name: str, payload: bytes, checksum: str) -> dict[str, Any]:
        results: dict[str, Any] = {}
        try:
            stored = open_managed_object(_StoredFile(name))  # type: ignore[arg-type]
        except ManagedObjectUnavailable as error:
            raise CommandError(f"The object could not be reopened for reading: {error}") from error

        # A provider-backed object must serve byte ranges. Without that the
        # delivery path falls back to the storage library's file object, which
        # downloads the whole object into the container before the first byte.
        results["ranged_reads"] = stored.uses_ranged_reads
        first_chunk = next(iter(stored.stream(start=0, length=4096, chunk_size=4096)), b"")
        if first_chunk != payload[:4096]:
            raise CommandError("The first bytes of the stored object did not match what was sent.")
        results["partial_read_without_full_download"] = True

        stored = open_managed_object(_StoredFile(name))  # type: ignore[arg-type]
        digest = hashlib.sha256()
        for chunk in stored.stream(chunk_size=256 * 1024):
            digest.update(chunk)
        if digest.hexdigest() != checksum:
            raise CommandError("The streamed object did not match its checksum.")
        results["full_stream_checksum_matches"] = True

        stored = open_managed_object(_StoredFile(name))  # type: ignore[arg-type]
        window = b"".join(stored.stream(start=RANGE_START, length=RANGE_LENGTH))
        if window != payload[RANGE_START : RANGE_START + RANGE_LENGTH]:
            raise CommandError("A ranged read returned the wrong bytes.")
        results["ranged_read_matches"] = True
        results["range_requested"] = f"bytes={RANGE_START}-{RANGE_START + RANGE_LENGTH - 1}"
        return results

    def _verify_not_public(self, name: str) -> str:
        """The bucket must refuse an unsigned request for the same object."""

        try:
            signed_url = default_storage.url(name)
        except Exception as error:  # noqa: BLE001 - a filesystem backend has no HTTP URL
            raise CommandError(
                f"Could not derive an object URL to test anonymous access: {error}"
            ) from error
        parts = urlsplit(signed_url)
        if parts.scheme not in {"http", "https"}:
            return "not_applicable"
        if not parts.query:
            raise CommandError(
                "The provider returned an unsigned object URL. Private study material would be "
                "readable by anyone holding the link; enable STORAGE_QUERYSTRING_AUTH."
            )
        unsigned_url = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
        request = Request(unsigned_url, method="GET")  # noqa: S310 - provider URL, scheme checked
        try:
            with urlopen(request, timeout=15) as response:  # noqa: S310 - scheme checked above
                status = response.status
        except HTTPError as error:
            return f"refused_{error.code}"
        except URLError as error:
            raise CommandError(
                f"Could not reach the provider to test anonymous access: {error.reason}"
            ) from error
        raise CommandError(
            f"The bucket served the object anonymously with HTTP {status}. Private study material "
            "must not be publicly readable; delivery goes through the authorized API only."
        )

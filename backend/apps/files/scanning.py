import socket
import struct
from dataclasses import dataclass
from datetime import timedelta
from typing import BinaryIO, Literal, Protocol
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.audit.services import record_audit
from platform_core.storage import ManagedObjectUnavailable, open_managed_object

from .models import ManagedFile
from .services import scan_retry_delay


class ScannerUnavailable(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class ScanResult:
    verdict: Literal["clean", "quarantined"]
    engine: str
    signature: str = ""


class FileScanner(Protocol):
    def scan(self, file_object: BinaryIO) -> ScanResult: ...


class ClamAVScanner:
    """Small clamd INSTREAM client so file bytes never need a public URL."""

    def __init__(self) -> None:
        self.host = str(settings.FILE_SCAN_HOST)
        self.port = int(settings.FILE_SCAN_PORT)
        self.connect_timeout = float(settings.FILE_SCAN_CONNECT_TIMEOUT_SECONDS)
        self.read_timeout = float(settings.FILE_SCAN_READ_TIMEOUT_SECONDS)
        self.chunk_size = int(settings.FILE_SCAN_CHUNK_BYTES)

    def scan(self, file_object: BinaryIO) -> ScanResult:
        try:
            with socket.create_connection(
                (self.host, self.port), timeout=self.connect_timeout
            ) as connection:
                connection.settimeout(self.read_timeout)
                connection.sendall(b"zINSTREAM\0")
                while chunk := file_object.read(self.chunk_size):
                    connection.sendall(struct.pack("!I", len(chunk)))
                    connection.sendall(chunk)
                connection.sendall(struct.pack("!I", 0))
                response = self._read_response(connection)
        except (OSError, TimeoutError) as error:
            raise ScannerUnavailable("scanner_unavailable") from error
        return self._parse_response(response)

    @staticmethod
    def _read_response(connection: socket.socket) -> str:
        payload = bytearray()
        while len(payload) <= 4096:
            chunk = connection.recv(1024)
            if not chunk:
                break
            payload.extend(chunk)
            if b"\0" in chunk or b"\n" in chunk:
                break
        if not payload:
            raise ScannerUnavailable("scanner_empty_response")
        return bytes(payload).rstrip(b"\0\r\n").decode("utf-8", errors="replace")

    @staticmethod
    def _parse_response(response: str) -> ScanResult:
        _, separator, result = response.partition(": ")
        if not separator:
            raise ScannerUnavailable("scanner_invalid_response")
        if result == "OK":
            return ScanResult(verdict="clean", engine="clamav")
        if result.endswith(" FOUND"):
            return ScanResult(
                verdict="quarantined",
                engine="clamav",
                signature=result.removesuffix(" FOUND")[:160],
            )
        raise ScannerUnavailable("scanner_error_response")


@transaction.atomic
def claim_next_scan() -> ManagedFile | None:
    now = timezone.now()
    queued = (
        ManagedFile.objects.select_for_update(skip_locked=True)
        .filter(scan_status=ManagedFile.ScanStatus.PENDING)
        .filter(Q(scan_next_attempt_at__isnull=True) | Q(scan_next_attempt_at__lte=now))
        .order_by("scan_next_attempt_at", "created_at")
        .first()
    )
    if queued is None:
        return None
    queued.scan_status = ManagedFile.ScanStatus.SCANNING
    queued.scan_attempts += 1
    queued.scan_started_at = now
    queued.scan_completed_at = None
    queued.scan_next_attempt_at = None
    queued.scan_error_code = ""
    queued.save(
        update_fields=(
            "scan_status",
            "scan_attempts",
            "scan_started_at",
            "scan_completed_at",
            "scan_next_attempt_at",
            "scan_error_code",
        )
    )
    return queued


@transaction.atomic
def persist_scan_result(*, managed_file_id: UUID, result: ScanResult) -> ManagedFile:
    managed_file = ManagedFile.objects.select_for_update().get(id=managed_file_id)
    if managed_file.scan_status != ManagedFile.ScanStatus.SCANNING:
        return managed_file
    now = timezone.now()
    previous = managed_file.scan_status
    managed_file.scan_status = result.verdict
    managed_file.scan_completed_at = now
    managed_file.scan_next_attempt_at = None
    managed_file.scan_engine = result.engine[:80]
    managed_file.scan_signature = result.signature[:160]
    managed_file.scan_error_code = ""
    managed_file.save(
        update_fields=(
            "scan_status",
            "scan_completed_at",
            "scan_next_attempt_at",
            "scan_engine",
            "scan_signature",
            "scan_error_code",
        )
    )
    record_audit(
        actor=None,
        action=f"file.scan.{result.verdict}",
        domain="files",
        target_type="files.managed_file",
        target_id=str(managed_file.id),
        reason="Automated malware scan completed.",
        source="files.scan_worker",
        previous_state={"scan_status": previous},
        new_state={"scan_status": result.verdict, "engine": result.engine},
        metadata={
            "attempt": managed_file.scan_attempts,
            "signature": result.signature if result.verdict == "quarantined" else "",
        },
    )
    return managed_file


@transaction.atomic
def persist_scan_failure(*, managed_file_id: UUID, error_code: str) -> ManagedFile:
    managed_file = ManagedFile.objects.select_for_update().get(id=managed_file_id)
    if managed_file.scan_status != ManagedFile.ScanStatus.SCANNING:
        return managed_file
    maximum_attempts = max(1, int(settings.FILE_SCAN_MAX_ATTEMPTS))
    terminal = managed_file.scan_attempts >= maximum_attempts
    now = timezone.now()
    managed_file.scan_status = (
        ManagedFile.ScanStatus.FAILED if terminal else ManagedFile.ScanStatus.PENDING
    )
    managed_file.scan_completed_at = now if terminal else None
    managed_file.scan_next_attempt_at = (
        None if terminal else now + scan_retry_delay(managed_file.scan_attempts)
    )
    managed_file.scan_error_code = error_code[:80]
    managed_file.save(
        update_fields=(
            "scan_status",
            "scan_completed_at",
            "scan_next_attempt_at",
            "scan_error_code",
        )
    )
    record_audit(
        actor=None,
        action="file.scan.failed" if terminal else "file.scan.retry_scheduled",
        domain="files",
        target_type="files.managed_file",
        target_id=str(managed_file.id),
        reason="Automated malware scanner could not produce a verdict.",
        source="files.scan_worker",
        previous_state={"scan_status": ManagedFile.ScanStatus.SCANNING},
        new_state={
            "scan_status": managed_file.scan_status,
            "next_attempt_at": managed_file.scan_next_attempt_at,
        },
        metadata={"attempt": managed_file.scan_attempts, "error_code": error_code[:80]},
    )
    return managed_file


def recover_stale_scans() -> int:
    timeout = max(1, int(settings.FILE_SCAN_CLAIM_TIMEOUT_SECONDS))
    cutoff = timezone.now() - timedelta(seconds=timeout)
    stale_ids = list(
        ManagedFile.objects.filter(
            scan_status=ManagedFile.ScanStatus.SCANNING,
            scan_started_at__lt=cutoff,
        ).values_list("id", flat=True)
    )
    for managed_file_id in stale_ids:
        persist_scan_failure(managed_file_id=managed_file_id, error_code="scan_timeout")
    return len(stale_ids)


def process_one_scan(*, scanner: FileScanner | None = None) -> bool:
    managed_file = claim_next_scan()
    if managed_file is None:
        return False
    selected_scanner = scanner or ClamAVScanner()
    try:
        stored_object = open_managed_object(managed_file.blob)
    except ManagedObjectUnavailable:
        persist_scan_failure(managed_file_id=managed_file.id, error_code="blob_unavailable")
        return True
    reader = stored_object.reader(chunk_size=int(settings.FILE_SCAN_CHUNK_BYTES))
    try:
        result = selected_scanner.scan(reader)  # type: ignore[arg-type]
    except ScannerUnavailable as error:
        persist_scan_failure(managed_file_id=managed_file.id, error_code=str(error))
    except OSError:
        persist_scan_failure(managed_file_id=managed_file.id, error_code="blob_unavailable")
    else:
        persist_scan_result(managed_file_id=managed_file.id, result=result)
    finally:
        reader.close()
    return True

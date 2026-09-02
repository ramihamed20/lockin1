import hashlib
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Literal
from uuid import UUID

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.services import record_audit

from .models import ManagedFile


class FileValidationError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ValidatedUpload:
    kind: str
    content_type: str
    size_bytes: int
    checksum_sha256: str


PDF_SIGNATURE = b"%PDF-"
AUDIO_TYPES = {
    "audio/mpeg": {".mp3"},
    "audio/wav": {".wav"},
    "audio/x-wav": {".wav"},
    "audio/ogg": {".ogg", ".oga"},
    "audio/mp4": {".m4a", ".mp4"},
}
IMAGE_TYPES = {
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
    "image/webp": {".webp"},
}


def _audio_signature_matches(content_type: str, head: bytes) -> bool:
    if content_type == "audio/mpeg":
        return head.startswith(b"ID3") or (
            len(head) >= 2 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0
        )
    if content_type in {"audio/wav", "audio/x-wav"}:
        return len(head) >= 12 and head.startswith(b"RIFF") and head[8:12] == b"WAVE"
    if content_type == "audio/ogg":
        return head.startswith(b"OggS")
    if content_type == "audio/mp4":
        return len(head) >= 12 and head[4:8] == b"ftyp"
    return False


def _image_signature_matches(content_type: str, head: bytes) -> bool:
    if content_type == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n") and head[12:16] == b"IHDR"
    if content_type == "image/webp":
        return len(head) >= 12 and head.startswith(b"RIFF") and head[8:12] == b"WEBP"
    return False


def _checksum(upload: UploadedFile) -> str:
    digest = hashlib.sha256()
    upload.seek(0)
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)
    return digest.hexdigest()


def validate_upload(*, upload: UploadedFile, kind: str) -> ValidatedUpload:
    if upload.size is None or upload.size <= 0:
        raise FileValidationError("The selected file is empty.")
    upload_name = upload.name
    if not upload_name:
        raise FileValidationError("The file name is not valid.")
    filename = Path(upload_name).name
    if filename != upload.name or filename in {".", ".."}:
        raise FileValidationError("The file name is not valid.")
    suffix = Path(filename).suffix.lower()
    supplied_type = (upload.content_type or "").lower()
    upload.seek(0)
    head = upload.read(32)
    upload.seek(0)

    if kind == ManagedFile.Kind.PDF:
        max_bytes = int(settings.CONTENT_MAX_PDF_BYTES)
        if (
            suffix != ".pdf"
            or supplied_type != "application/pdf"
            or not head.startswith(PDF_SIGNATURE)
        ):
            raise FileValidationError("The file is not a valid PDF document.")
        canonical_type = "application/pdf"
    elif kind == ManagedFile.Kind.AUDIO:
        max_bytes = int(settings.CONTENT_MAX_AUDIO_BYTES)
        if suffix not in AUDIO_TYPES.get(supplied_type, set()) or not _audio_signature_matches(
            supplied_type, head
        ):
            raise FileValidationError("The audio type does not match the uploaded file.")
        canonical_type = supplied_type
    elif kind == ManagedFile.Kind.AVATAR:
        max_bytes = int(settings.PROFILE_AVATAR_MAX_BYTES)
        if suffix not in IMAGE_TYPES.get(supplied_type, set()) or not _image_signature_matches(
            supplied_type, head
        ):
            raise FileValidationError("Choose a valid JPEG, PNG, or WebP image.")
        canonical_type = supplied_type
    else:
        raise FileValidationError("This file type is not supported.")
    if upload.size > max_bytes:
        raise FileValidationError("The selected file exceeds the configured size limit.")
    return ValidatedUpload(
        kind=kind,
        content_type=canonical_type,
        size_bytes=upload.size,
        checksum_sha256=_checksum(upload),
    )


@transaction.atomic
def create_managed_file(*, owner: User, upload: UploadedFile, kind: str) -> ManagedFile:
    validated = validate_upload(upload=upload, kind=kind)
    scan_required = bool(settings.CONTENT_REQUIRE_CLEAN_SCAN)
    now = timezone.now()
    return ManagedFile.objects.create(
        owner=owner,
        kind=validated.kind,
        blob=upload,
        original_name=Path(upload.name or "upload").name[:255],
        content_type=validated.content_type,
        size_bytes=validated.size_bytes,
        checksum_sha256=validated.checksum_sha256,
        validation_status=ManagedFile.ValidationStatus.READY,
        scan_status=(
            ManagedFile.ScanStatus.PENDING
            if scan_required
            else ManagedFile.ScanStatus.NOT_CONFIGURED
        ),
        scan_requested_at=now if scan_required else None,
        scan_next_attempt_at=now if scan_required else None,
    )


class ScanDecisionError(ValueError):
    pass


OperatorScanDecision = Literal["clean", "quarantined", "failed"]


@transaction.atomic
def record_operator_scan_decision(
    *,
    actor: User,
    managed_file_id: UUID,
    decision: OperatorScanDecision,
    reason: str,
) -> ManagedFile:
    """Apply a capability-gated manual decision with owner/operator separation."""

    normalized_reason = reason.strip()
    if len(normalized_reason) < 10:
        raise ScanDecisionError("A specific reason of at least 10 characters is required.")
    if decision not in {
        ManagedFile.ScanStatus.CLEAN,
        ManagedFile.ScanStatus.QUARANTINED,
        ManagedFile.ScanStatus.FAILED,
    }:
        raise ScanDecisionError("This scan decision is not supported.")
    managed_file = ManagedFile.objects.select_for_update().get(id=managed_file_id)
    if decision == "clean" and managed_file.owner_id == actor.id:
        raise ScanDecisionError("A file owner cannot approve their own upload.")
    previous = managed_file.scan_status
    if previous == decision:
        return managed_file
    now = timezone.now()
    managed_file.scan_status = decision
    managed_file.scan_completed_at = now
    managed_file.scan_next_attempt_at = None
    managed_file.scan_error_code = "operator_rejected" if decision != "clean" else ""
    managed_file.scan_engine = "operator-override"
    managed_file.scan_signature = ""
    managed_file.save(
        update_fields=(
            "scan_status",
            "scan_completed_at",
            "scan_next_attempt_at",
            "scan_error_code",
            "scan_engine",
            "scan_signature",
        )
    )
    record_audit(
        actor=actor,
        action=f"file.scan.{decision}",
        domain="files",
        target_type="files.managed_file",
        target_id=str(managed_file.id),
        reason=normalized_reason,
        source="operations.file_scan_decision",
        previous_state={"scan_status": previous},
        new_state={"scan_status": decision, "engine": "operator-override"},
        metadata={"owner_id": str(managed_file.owner_id)},
    )
    return managed_file


def scan_retry_delay(attempt: int) -> timedelta:
    base = max(1, int(getattr(settings, "FILE_SCAN_RETRY_BASE_SECONDS", 30)))
    maximum = max(base, int(getattr(settings, "FILE_SCAN_RETRY_MAX_SECONDS", 900)))
    return timedelta(seconds=min(maximum, base * (2 ** max(0, attempt - 1))))

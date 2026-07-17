import hashlib
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import transaction

from apps.accounts.models import User

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
    return ManagedFile.objects.create(
        owner=owner,
        kind=validated.kind,
        blob=upload,
        original_name=Path(upload.name or "upload").name[:255],
        content_type=validated.content_type,
        size_bytes=validated.size_bytes,
        checksum_sha256=validated.checksum_sha256,
        validation_status=ManagedFile.ValidationStatus.READY,
        scan_status=ManagedFile.ScanStatus.NOT_CONFIGURED,
    )

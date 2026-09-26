"""The administrator-managed background media of the Paper Workspace player.

Students only ever receive the published media: an enabled setting pointing at
a validated, unquarantined ``workspace_media`` file. Everything else falls back
to the workspace's built-in lofi scene, which needs no server state at all.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.conf import settings
from django.db import transaction

from apps.accounts.models import User
from apps.audit.services import record_audit
from apps.files.models import ManagedFile

from .models import PaperWorkspaceMedia

RECOMMENDED = {"width": 1920, "height": 1080, "alternative": "1280×720", "aspect_ratio": "16:9"}
VIDEO_TYPES = {"video/mp4", "video/webm"}


class PaperWorkspaceMediaError(ValueError):
    pass


class PaperWorkspaceMediaConflict(PaperWorkspaceMediaError):
    pass


def _deliverable(managed_file: ManagedFile | None) -> bool:
    if managed_file is None or managed_file.kind != ManagedFile.Kind.WORKSPACE_MEDIA:
        return False
    if managed_file.validation_status != ManagedFile.ValidationStatus.READY:
        return False
    if managed_file.scan_status in {
        ManagedFile.ScanStatus.QUARANTINED,
        ManagedFile.ScanStatus.FAILED,
    }:
        return False
    return not (
        settings.CONTENT_REQUIRE_CLEAN_SCAN
        and managed_file.scan_status != ManagedFile.ScanStatus.CLEAN
    )


def _current() -> PaperWorkspaceMedia:
    return (
        PaperWorkspaceMedia.objects.select_related("managed_file")
        .filter(id=PaperWorkspaceMedia.SINGLETON_ID)
        .first()
        or PaperWorkspaceMedia()
    )


def is_published_media(file_id: UUID) -> bool:
    return PaperWorkspaceMedia.objects.filter(
        id=PaperWorkspaceMedia.SINGLETON_ID, enabled=True, managed_file_id=file_id
    ).exists()


def _file_payload(managed_file: ManagedFile) -> dict[str, object]:
    return {
        "id": str(managed_file.id),
        "url": f"/api/v1/files/{managed_file.id}/view",
        "content_type": managed_file.content_type,
        "media_type": "video" if managed_file.content_type in VIDEO_TYPES else "image",
        "original_name": managed_file.original_name,
        "size_bytes": managed_file.size_bytes,
    }


def student_payload() -> dict[str, Any]:
    """The media a student's player should show, or ``None`` for the lofi scene."""

    media = _current()
    managed_file = media.managed_file
    if not media.enabled or managed_file is None or not _deliverable(managed_file):
        return {"media": None}
    return {
        "media": {
            **_file_payload(managed_file),
            "focal_x": media.focal_x,
            "focal_y": media.focal_y,
            "revision": media.revision,
        }
    }


def admin_payload() -> dict[str, Any]:
    media = _current()
    return {
        "enabled": media.enabled,
        "focal_x": media.focal_x,
        "focal_y": media.focal_y,
        "revision": media.revision,
        "updated_at": media.updated_at.isoformat() if media.updated_at else None,
        "file": _file_payload(media.managed_file) if media.managed_file else None,
        "deliverable": _deliverable(media.managed_file),
        "recommended": RECOMMENDED,
        "max_bytes": int(settings.PAPER_WORKSPACE_MEDIA_MAX_BYTES),
    }


def _state(media: PaperWorkspaceMedia) -> dict[str, object]:
    return {
        "file_id": str(media.managed_file_id) if media.managed_file_id else None,
        "enabled": media.enabled,
        "focal_x": media.focal_x,
        "focal_y": media.focal_y,
        "revision": media.revision,
    }


def _locked(expected_revision: int) -> PaperWorkspaceMedia:
    media, _ = PaperWorkspaceMedia.objects.select_for_update().get_or_create(
        id=PaperWorkspaceMedia.SINGLETON_ID
    )
    if media.revision != expected_revision:
        raise PaperWorkspaceMediaConflict(
            "The Paper Workspace media changed. Reload it and try again."
        )
    return media


def _audit(
    *, actor: User, action: str, previous: dict[str, object], media: PaperWorkspaceMedia
) -> None:
    record_audit(
        actor=actor,
        action=action,
        domain="focus",
        target_type="focus.paper_workspace_media",
        target_id=str(media.id),
        reason="Paper Workspace media management.",
        source="paper_workspace_media.api",
        previous_state=previous,
        new_state=_state(media),
    )


@transaction.atomic
def save_media(
    *,
    actor: User,
    expected_revision: int,
    file_id: UUID | None,
    enabled: bool,
    focal_x: int,
    focal_y: int,
) -> dict[str, Any]:
    """Replace the file (when ``file_id`` is given) and update the display settings."""

    media = _locked(expected_revision)
    previous = _state(media)
    if file_id is not None:
        managed_file = ManagedFile.objects.filter(id=file_id).first()
        if managed_file is None or managed_file.kind != ManagedFile.Kind.WORKSPACE_MEDIA:
            raise PaperWorkspaceMediaError("Upload the media as Paper Workspace media first.")
        if not _deliverable(managed_file):
            raise PaperWorkspaceMediaError("This file is not ready to be shown to students.")
        media.managed_file = managed_file
    if enabled and media.managed_file is None:
        raise PaperWorkspaceMediaError("Upload media before enabling it.")
    if not (0 <= focal_x <= 100 and 0 <= focal_y <= 100):
        raise PaperWorkspaceMediaError("The focal point must be between 0 and 100.")
    media.enabled = enabled
    media.focal_x = focal_x
    media.focal_y = focal_y
    media.revision += 1
    media.updated_by = actor
    media.save()
    _audit(actor=actor, action="focus.paper_workspace_media_saved", previous=previous, media=media)
    return admin_payload()


@transaction.atomic
def remove_media(*, actor: User, expected_revision: int) -> dict[str, Any]:
    """Detach the media; students fall back to the built-in lofi scene."""

    media = _locked(expected_revision)
    previous = _state(media)
    media.managed_file = None
    media.enabled = False
    media.focal_x = media.focal_y = 50
    media.revision += 1
    media.updated_by = actor
    media.save()
    _audit(
        actor=actor, action="focus.paper_workspace_media_removed", previous=previous, media=media
    )
    return admin_payload()

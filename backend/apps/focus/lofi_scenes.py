"""Administrator-managed Lo-Fi scenes for the Paper Workspace player.

Upload once, store once, loop on the client. Each scene keeps exactly the short
clip an administrator uploaded (and an optional cover image); the player
repeats that one file for the whole study session. Nothing here ever renders,
concatenates or copies media, and a file a scene stops using is removed from
storage once no scene refers to it.

Students only ever receive enabled scenes whose files are validated and not
quarantined. With no such scene the player keeps its built-in lofi scene.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.db.models import Max, Q, QuerySet

from apps.accounts.models import User
from apps.audit.services import record_audit
from apps.files.models import ManagedFile

from .models import LofiScene

logger = logging.getLogger(__name__)

RECOMMENDED = {"width": 1920, "height": 1080, "alternative": "1280×720", "aspect_ratio": "16:9"}
VIDEO_TYPES = {"video/mp4", "video/webm"}
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_SCENES = 24


class LofiSceneError(ValueError):
    pass


class LofiSceneConflict(LofiSceneError):
    pass


class LofiSceneNotFound(LofiSceneError):
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


def _scenes() -> QuerySet[LofiScene]:
    return LofiScene.objects.select_related("media_file", "cover_file").order_by(
        "position", "created_at"
    )


def is_published_media(file_id: UUID) -> bool:
    """Whether a student may view this file: the clip or cover of an enabled scene."""

    return LofiScene.objects.filter(
        Q(media_file_id=file_id) | Q(cover_file_id=file_id), enabled=True
    ).exists()


def _url(managed_file: ManagedFile) -> str:
    # A file's bytes never change under its id, so this URL is stable and the
    # delivery view lets the browser keep it (see apps.files.views).
    return f"/api/v1/files/{managed_file.id}/view"


def _file_payload(managed_file: ManagedFile) -> dict[str, object]:
    return {
        "id": str(managed_file.id),
        "url": _url(managed_file),
        "content_type": managed_file.content_type,
        "media_type": "video" if managed_file.content_type in VIDEO_TYPES else "image",
        "original_name": managed_file.original_name,
        "size_bytes": managed_file.size_bytes,
        "duration_ms": managed_file.duration_ms,
    }


def _student_scene(scene: LofiScene) -> dict[str, object]:
    media = scene.media_file
    cover = scene.cover_file if _deliverable(scene.cover_file) else None
    return {
        "id": str(scene.id),
        "title": scene.title,
        "url": _url(media),
        "content_type": media.content_type,
        "media_type": "video" if media.content_type in VIDEO_TYPES else "image",
        "duration_ms": media.duration_ms,
        "cover_url": _url(cover) if cover else None,
        "focal_x": scene.focal_x,
        "focal_y": scene.focal_y,
        "revision": scene.revision,
    }


def student_payload() -> dict[str, Any]:
    """The scenes a student can choose from, in order (empty = built-in scene)."""

    return {
        "scenes": [
            _student_scene(scene)
            for scene in _scenes().filter(enabled=True)
            if _deliverable(scene.media_file)
        ]
    }


def _admin_scene(scene: LofiScene) -> dict[str, object]:
    return {
        "id": str(scene.id),
        "title": scene.title,
        "enabled": scene.enabled,
        "position": scene.position,
        "focal_x": scene.focal_x,
        "focal_y": scene.focal_y,
        "revision": scene.revision,
        "updated_at": scene.updated_at.isoformat() if scene.updated_at else None,
        "media": _file_payload(scene.media_file),
        "cover": _file_payload(scene.cover_file) if scene.cover_file else None,
        "deliverable": _deliverable(scene.media_file),
    }


def admin_payload() -> dict[str, Any]:
    return {
        "scenes": [_admin_scene(scene) for scene in _scenes()],
        "recommended": RECOMMENDED,
        "max_bytes": int(settings.PAPER_WORKSPACE_MEDIA_MAX_BYTES),
        "min_seconds": int(settings.LOFI_VIDEO_MIN_SECONDS),
        "max_seconds": int(settings.LOFI_VIDEO_MAX_SECONDS),
        "max_scenes": MAX_SCENES,
    }


def _state(scene: LofiScene) -> dict[str, object]:
    return {
        "title": scene.title,
        "media_file_id": str(scene.media_file_id),
        "cover_file_id": str(scene.cover_file_id) if scene.cover_file_id else None,
        "enabled": scene.enabled,
        "position": scene.position,
        "focal_x": scene.focal_x,
        "focal_y": scene.focal_y,
        "revision": scene.revision,
    }


def _audit(
    *,
    actor: User,
    action: str,
    scene_id: object,
    previous: dict[str, object] | None,
    new: dict[str, object] | None,
) -> None:
    record_audit(
        actor=actor,
        action=action,
        domain="focus",
        target_type="focus.lofi_scene",
        target_id=str(scene_id),
        reason="Lo-Fi scene management.",
        source="lofi_scenes.api",
        previous_state=previous,
        new_state=new,
    )


def _upload(file_id: UUID, *, video: bool) -> ManagedFile:
    managed_file = ManagedFile.objects.filter(id=file_id).first()
    if managed_file is None or managed_file.kind != ManagedFile.Kind.WORKSPACE_MEDIA:
        raise LofiSceneError("Upload the file as Lo-Fi media first.")
    if video and managed_file.content_type not in VIDEO_TYPES | IMAGE_TYPES:
        raise LofiSceneError("A scene needs an MP4 or WebM video.")
    if not video and managed_file.content_type not in IMAGE_TYPES:
        raise LofiSceneError("The cover must be a JPEG, PNG, WebP or GIF image.")
    if not _deliverable(managed_file):
        raise LofiSceneError("This file is not ready to be shown to students.")
    return managed_file


def _title(value: str) -> str:
    title = " ".join(str(value).split())
    if not title:
        raise LofiSceneError("Give the scene a title.")
    if len(title) > 80:
        raise LofiSceneError("Keep the title under 80 characters.")
    return title


def _focal(focal_x: int, focal_y: int) -> None:
    if not (0 <= focal_x <= 100 and 0 <= focal_y <= 100):
        raise LofiSceneError("The focal point must be between 0 and 100.")


def _purge_unused(file_ids: set[UUID]) -> None:
    """Remove files no scene uses any more, from the database and from storage.

    Runs after the transaction commits, so a rolled-back change never loses a
    file, and a storage hiccup never undoes a saved change (it is only logged).
    """

    candidates = {file_id for file_id in file_ids if file_id}
    if not candidates:
        return

    def purge() -> None:
        still_used = set(
            LofiScene.objects.filter(media_file_id__in=candidates).values_list(
                "media_file_id", flat=True
            )
        ) | set(
            LofiScene.objects.filter(cover_file_id__in=candidates).values_list(
                "cover_file_id", flat=True
            )
        )
        for managed_file in ManagedFile.objects.filter(
            id__in=candidates - still_used, kind=ManagedFile.Kind.WORKSPACE_MEDIA
        ):
            try:
                managed_file.blob.delete(save=False)
            except Exception:  # noqa: BLE001 - storage cleanup must not fail a saved change
                logger.warning("Lo-Fi media blob could not be deleted", exc_info=True)
            managed_file.delete()

    transaction.on_commit(purge)


def _locked(scene_id: UUID, expected_revision: int) -> LofiScene:
    scene = LofiScene.objects.select_for_update().filter(id=scene_id).first()
    if scene is None:
        raise LofiSceneNotFound("This scene no longer exists.")
    if scene.revision != expected_revision:
        raise LofiSceneConflict("This scene changed. Reload it and try again.")
    return scene


@transaction.atomic
def create_scene(
    *,
    actor: User,
    title: str,
    media_file_id: UUID,
    cover_file_id: UUID | None,
    enabled: bool,
    focal_x: int,
    focal_y: int,
) -> dict[str, Any]:
    if LofiScene.objects.select_for_update().count() >= MAX_SCENES:
        raise LofiSceneError(f"There can be at most {MAX_SCENES} scenes. Delete one first.")
    _focal(focal_x, focal_y)
    last = LofiScene.objects.aggregate(last=Max("position"))["last"]
    scene = LofiScene.objects.create(
        title=_title(title),
        media_file=_upload(media_file_id, video=True),
        cover_file=_upload(cover_file_id, video=False) if cover_file_id else None,
        enabled=enabled,
        position=0 if last is None else last + 1,
        focal_x=focal_x,
        focal_y=focal_y,
        created_by=actor,
        updated_by=actor,
    )
    _audit(
        actor=actor,
        action="focus.lofi_scene_created",
        scene_id=scene.id,
        previous=None,
        new=_state(scene),
    )
    return admin_payload()


@transaction.atomic
def update_scene(
    *,
    actor: User,
    scene_id: UUID,
    expected_revision: int,
    changes: dict[str, Any],
) -> dict[str, Any]:
    """Apply the given fields; ``media_file_id`` replaces the clip, ``cover_file_id``
    replaces or (``None``) removes the cover. A replaced file leaves storage."""

    scene = _locked(scene_id, expected_revision)
    previous = _state(scene)
    released: set[UUID] = set()
    if "title" in changes:
        scene.title = _title(changes["title"])
    if changes.get("media_file_id") and changes["media_file_id"] != scene.media_file_id:
        released.add(scene.media_file_id)
        scene.media_file = _upload(changes["media_file_id"], video=True)
    if "cover_file_id" in changes and changes["cover_file_id"] != scene.cover_file_id:
        if scene.cover_file_id:
            released.add(scene.cover_file_id)
        scene.cover_file = (
            _upload(changes["cover_file_id"], video=False) if changes["cover_file_id"] else None
        )
    if "enabled" in changes:
        scene.enabled = bool(changes["enabled"])
    if "focal_x" in changes or "focal_y" in changes:
        focal_x = int(changes.get("focal_x", scene.focal_x))
        focal_y = int(changes.get("focal_y", scene.focal_y))
        _focal(focal_x, focal_y)
        scene.focal_x, scene.focal_y = focal_x, focal_y
    scene.revision += 1
    scene.updated_by = actor
    scene.save()
    _purge_unused(released)
    _audit(
        actor=actor,
        action="focus.lofi_scene_updated",
        scene_id=scene.id,
        previous=previous,
        new=_state(scene),
    )
    return admin_payload()


@transaction.atomic
def delete_scene(*, actor: User, scene_id: UUID, expected_revision: int) -> dict[str, Any]:
    scene = _locked(scene_id, expected_revision)
    previous = _state(scene)
    released = {scene.media_file_id, *([scene.cover_file_id] if scene.cover_file_id else [])}
    scene.delete()
    _purge_unused(released)
    _audit(
        actor=actor,
        action="focus.lofi_scene_deleted",
        scene_id=scene_id,
        previous=previous,
        new=None,
    )
    return admin_payload()


@transaction.atomic
def reorder_scenes(*, actor: User, scene_ids: list[UUID]) -> dict[str, Any]:
    """Set the order students see. The list must name every scene exactly once."""

    scenes = {scene.id: scene for scene in LofiScene.objects.select_for_update()}
    if len(scene_ids) != len(set(scene_ids)) or set(scene_ids) != set(scenes):
        raise LofiSceneConflict("The scenes changed. Reload them and try again.")
    previous = {str(scene_id): scene.position for scene_id, scene in scenes.items()}
    for position, scene_id in enumerate(scene_ids):
        scene = scenes[scene_id]
        if scene.position != position:
            scene.position = position
            scene.revision += 1
            scene.updated_by = actor
            scene.save(update_fields=("position", "revision", "updated_by", "updated_at"))
    _audit(
        actor=actor,
        action="focus.lofi_scenes_reordered",
        scene_id="order",
        previous={"positions": previous},
        new={"positions": {str(scene_id): index for index, scene_id in enumerate(scene_ids)}},
    )
    return admin_payload()

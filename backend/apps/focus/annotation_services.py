import hashlib
import json
from dataclasses import asdict
from decimal import Decimal
from typing import Any
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User

from .domain_types import AnnotationMutation, AnnotationSyncResult
from .models import (
    FocusAnnotation,
    FocusAnnotationCollection,
    FocusSyncReceipt,
)
from .validation import (
    FocusValidationError,
    validate_bounds,
    validate_color,
    validate_payload,
)

MAX_SYNC_MUTATIONS = 100


class FocusAnnotationConflictError(ValueError):
    pass


def annotation_payload(annotation: FocusAnnotation) -> dict[str, Any]:
    return {
        "id": str(annotation.id),
        "page_number": annotation.page_number,
        "tool": annotation.tool,
        "layer_key": annotation.layer_key,
        "bounds": annotation.bounds,
        "payload": annotation.payload,
        "color": annotation.color,
        "thickness": float(annotation.thickness),
        "opacity": float(annotation.opacity),
        "revision": annotation.revision,
        "created_at": annotation.created_at.isoformat(),
        "updated_at": annotation.updated_at.isoformat(),
    }


def _request_digest(
    *,
    document_id: UUID,
    document_version_id: UUID,
    expected_revision: int,
    annotations: tuple[AnnotationMutation, ...],
    deleted_ids: tuple[UUID, ...],
) -> str:
    body = {
        "document_id": str(document_id),
        "document_version_id": str(document_version_id),
        "expected_revision": expected_revision,
        "annotations": [
            {
                **asdict(annotation),
                "annotation_id": str(annotation.annotation_id),
                "thickness": str(annotation.thickness),
                "opacity": str(annotation.opacity),
            }
            for annotation in annotations
        ],
        "deleted_ids": [str(value) for value in deleted_ids],
    }
    encoded = json.dumps(
        body,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _result_from_payload(payload: dict[str, Any], *, replayed: bool) -> AnnotationSyncResult:
    return AnnotationSyncResult(
        collection_revision=int(payload["collection_revision"]),
        saved_at=str(payload["saved_at"]),
        annotations=tuple(payload.get("annotations", [])),
        deleted_ids=tuple(payload.get("deleted_ids", [])),
        replayed=replayed,
    )


@transaction.atomic
def sync_annotations(
    *,
    user: User,
    document_id: UUID,
    document_version_id: UUID,
    page_count: int | None,
    expected_revision: int,
    idempotency_key: UUID,
    annotations: tuple[AnnotationMutation, ...],
    deleted_ids: tuple[UUID, ...],
) -> AnnotationSyncResult:
    if len(annotations) + len(deleted_ids) > MAX_SYNC_MUTATIONS:
        raise FocusValidationError("A Focus sync can contain at most 100 mutations.")
    if len({item.annotation_id for item in annotations}) != len(annotations):
        raise FocusValidationError("Annotation mutations cannot contain duplicate identifiers.")
    if len(set(deleted_ids)) != len(deleted_ids):
        raise FocusValidationError("Deleted annotation identifiers cannot be duplicated.")
    if {item.annotation_id for item in annotations}.intersection(deleted_ids):
        raise FocusValidationError("An annotation cannot be saved and deleted in the same sync.")

    digest = _request_digest(
        document_id=document_id,
        document_version_id=document_version_id,
        expected_revision=expected_revision,
        annotations=annotations,
        deleted_ids=deleted_ids,
    )
    User.objects.select_for_update().get(id=user.id)
    collection, _ = FocusAnnotationCollection.objects.get_or_create(
        user=user,
        document_version_id=document_version_id,
        defaults={"document_id": document_id},
    )
    collection = FocusAnnotationCollection.objects.select_for_update().get(id=collection.id)
    if collection.document_id != document_id:
        raise FocusValidationError("The annotation document reference does not match.")
    receipt = FocusSyncReceipt.objects.filter(
        collection=collection,
        idempotency_key=idempotency_key,
    ).first()
    if receipt is not None:
        if receipt.request_digest != digest:
            raise FocusValidationError(
                "The annotation idempotency key was already used for another sync."
            )
        return _result_from_payload(receipt.response_payload, replayed=True)
    if collection.revision != expected_revision:
        raise FocusAnnotationConflictError("Annotations changed. Reload them and try again.")

    changed: list[FocusAnnotation] = []
    saved_at = timezone.now()
    for mutation in annotations:
        if page_count is not None and mutation.page_number > page_count:
            raise FocusValidationError("An annotation page is outside the document.")
        bounds = validate_bounds(mutation.bounds)
        payload = validate_payload(tool=mutation.tool, value=mutation.payload)
        color = validate_color(mutation.color)
        thickness = Decimal(mutation.thickness).quantize(Decimal("0.01"))
        opacity = Decimal(mutation.opacity).quantize(Decimal("0.001"))
        existing = FocusAnnotation.objects.filter(
            id=mutation.annotation_id,
            collection=collection,
        ).first()
        if existing is None:
            if FocusAnnotation.objects.filter(id=mutation.annotation_id).exists():
                raise FocusValidationError("An annotation identifier is not available.")
            existing = FocusAnnotation(
                id=mutation.annotation_id,
                collection=collection,
                revision=1,
            )
        elif existing.deleted_at is not None:
            existing.deleted_at = None
            existing.revision += 1
            existing.save(update_fields=("deleted_at", "revision", "updated_at"))
        else:
            existing.revision += 1
        existing.page_number = mutation.page_number
        existing.tool = mutation.tool
        existing.layer_key = mutation.layer_key
        existing.bounds = bounds
        existing.payload = payload
        existing.color = color
        existing.thickness = thickness
        existing.opacity = opacity
        existing.full_clean()
        existing.save()
        changed.append(existing)

    deleted: list[str] = []
    for annotation in FocusAnnotation.objects.select_for_update().filter(
        id__in=deleted_ids,
        collection=collection,
        deleted_at__isnull=True,
    ):
        annotation.deleted_at = saved_at
        annotation.revision += 1
        annotation.save(update_fields=("deleted_at", "revision", "updated_at"))
        deleted.append(str(annotation.id))

    if changed or deleted:
        collection.revision += 1
        collection.save(update_fields=("revision", "updated_at"))
    payload = {
        "collection_revision": collection.revision,
        "saved_at": saved_at.isoformat(),
        "annotations": [annotation_payload(item) for item in changed],
        "deleted_ids": deleted,
    }
    FocusSyncReceipt.objects.create(
        collection=collection,
        requested_by=user,
        idempotency_key=idempotency_key,
        request_digest=digest,
        response_payload=payload,
    )
    return _result_from_payload(payload, replayed=False)

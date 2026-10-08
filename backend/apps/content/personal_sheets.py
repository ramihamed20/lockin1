"""Students' own PDF sheets, filed under one of their subjects.

A personal sheet is private to its owner. It is stored as an ordinary managed
PDF, so validation, scanning and delivery are the files domain's own, and the
delivery route already lets an owner read their file while the subscription
gate still applies.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import IntegrityError, transaction
from django.db.models import QuerySet

from apps.accounts.models import User
from apps.education.policies import is_content_administrator
from apps.files.models import ManagedFile
from apps.files.services import (
    FileValidationError,
    create_managed_file,
    managed_file_delivery_ready,
)

from .models import (
    CatalogSubject,
    PersonalSheet,
    PersonalSheetWorkspace,
    PersonalSheetWorkspaceReceipt,
)

logger = logging.getLogger("lockin.catalog")

TITLE_MAX_LENGTH = 120
_WHITESPACE = re.compile(r"\s+")


class PersonalSheetError(ValueError):
    code = "personal_sheet_invalid"
    field = "file"


class PersonalSheetTitleError(PersonalSheetError):
    code = "personal_sheet_title_invalid"
    field = "title"


class PersonalSheetTitleTaken(PersonalSheetError):
    code = "personal_sheet_title_taken"
    field = "title"


class PersonalSheetLimitReached(PersonalSheetError):
    code = "personal_sheet_limit_reached"
    field = "file"


class PersonalWorkspaceConflict(Exception):
    """The reader saved over a revision another device has already replaced."""


class PersonalWorkspaceKeyReused(Exception):
    pass


def max_sheets_per_account() -> int:
    return int(settings.PERSONAL_SHEETS_MAX_PER_ACCOUNT)


def max_sheet_bytes() -> int:
    return int(settings.PERSONAL_SHEET_MAX_BYTES)


def visible_subject(*, user: User, material_slug: str) -> CatalogSubject | None:
    """The subject this account may file sheets under: one its cohort owns."""

    subjects = CatalogSubject.objects.filter(is_active=True, material_slug=material_slug)
    if not is_content_administrator(user):
        cohort = user.cohort
        if cohort is None or not cohort.is_active:
            return None
        subjects = subjects.filter(cohort_id=cohort.id)
    return subjects.first()


def owned_sheets(*, owner: User, subject: CatalogSubject) -> QuerySet[PersonalSheet]:
    return (
        PersonalSheet.objects.filter(owner=owner, subject=subject)
        .select_related("managed_file")
        .order_by("-created_at", "-id")
    )


def account_sheet_count(owner: User) -> int:
    return PersonalSheet.objects.filter(owner=owner).count()


def normalize_title(value: object) -> str:
    title = _WHITESPACE.sub(" ", str(value or "")).strip()
    if not title:
        raise PersonalSheetTitleError("Give the sheet a name.")
    if len(title) > TITLE_MAX_LENGTH:
        raise PersonalSheetTitleError(f"Keep the name under {TITLE_MAX_LENGTH} characters.")
    return title


def delivery_status(managed_file: ManagedFile) -> str:
    if managed_file_delivery_ready(managed_file):
        return "ready"
    if (
        managed_file.scan_status
        in {
            ManagedFile.ScanStatus.PENDING,
            ManagedFile.ScanStatus.SCANNING,
        }
        and managed_file.validation_status == ManagedFile.ValidationStatus.READY
    ):
        return "processing"
    return "unavailable"


def _delete_blob_after_commit(managed_file: ManagedFile) -> None:
    storage = managed_file.blob.storage
    name = managed_file.blob.name

    def delete() -> None:
        if not name:
            return
        try:
            storage.delete(name)
        except Exception:  # noqa: BLE001 - a stray object must not fail a saved change
            logger.warning("Personal sheet blob could not be deleted", exc_info=True)

    transaction.on_commit(delete)


def _discard_rejected_upload(managed_file: ManagedFile) -> None:
    # The surrounding transaction rolls back the row, and with it any on_commit
    # hook, so the stored bytes are removed here or never.
    name = managed_file.blob.name
    if not name:
        return
    try:
        managed_file.blob.storage.delete(name)
    except Exception:  # noqa: BLE001 - the rejection is still reported to the student
        logger.warning("Rejected personal sheet blob could not be deleted", exc_info=True)


def add_personal_sheet(
    *,
    owner: User,
    subject: CatalogSubject,
    title: object,
    upload: UploadedFile,
) -> PersonalSheet:
    normalized = normalize_title(title)
    limit_bytes = max_sheet_bytes()
    if upload.size is not None and upload.size > limit_bytes:
        raise PersonalSheetError(f"The file is larger than {limit_bytes // (1024 * 1024)} MB.")
    with transaction.atomic():
        # One lock per account keeps two uploads in flight from both passing
        # the count and leaving the account over its limit.
        User.objects.select_for_update().filter(id=owner.id).first()
        if account_sheet_count(owner) >= max_sheets_per_account():
            raise PersonalSheetLimitReached(
                f"You can keep up to {max_sheets_per_account()} sheets of your own."
            )
        if PersonalSheet.objects.filter(
            owner=owner, subject=subject, title__iexact=normalized
        ).exists():
            raise PersonalSheetTitleTaken("You already have a sheet with this name here.")
        try:
            managed_file = create_managed_file(
                owner=owner, upload=upload, kind=ManagedFile.Kind.PDF
            )
        except FileValidationError as error:
            raise PersonalSheetError("Choose a PDF file.") from error
        if not managed_file.pdf_page_count:
            _discard_rejected_upload(managed_file)
            raise PersonalSheetError("This PDF could not be read. Try another file.")
        try:
            with transaction.atomic():
                return PersonalSheet.objects.create(
                    owner=owner,
                    subject=subject,
                    managed_file=managed_file,
                    title=normalized,
                    page_count=managed_file.pdf_page_count,
                )
        except IntegrityError as error:
            _discard_rejected_upload(managed_file)
            raise PersonalSheetTitleTaken(
                "You already have a sheet with this name here."
            ) from error


def owned_sheet(*, owner: User, sheet_id: UUID) -> PersonalSheet | None:
    return (
        PersonalSheet.objects.select_related("managed_file", "subject")
        .filter(id=sheet_id, owner=owner)
        .first()
    )


def sheet_workspace(sheet: PersonalSheet) -> PersonalSheetWorkspace:
    workspace, _ = PersonalSheetWorkspace.objects.get_or_create(sheet=sheet)
    return workspace


def workspace_revision(sheet: PersonalSheet) -> int:
    revision = (
        PersonalSheetWorkspace.objects.filter(sheet=sheet)
        .values_list("revision", flat=True)
        .first()
    )
    return int(revision or 0)


@dataclass(frozen=True, slots=True)
class WorkspaceSave:
    payload: dict[str, Any]
    replayed: bool


@transaction.atomic
def save_sheet_workspace(
    *,
    sheet: PersonalSheet,
    expected_revision: int,
    idempotency_key: UUID,
    state: dict[str, Any],
) -> WorkspaceSave:
    """Replace the reader state if nobody saved since `expected_revision`.

    The same contract as a catalog sheet's workspace: one key answers one
    request, so a retry after a lost response is replayed rather than applied
    twice, and a stale revision is a conflict the reader resolves by merging.
    """

    encoded = json.dumps(
        {"expected": expected_revision, "state": state}, sort_keys=True, separators=(",", ":")
    ).encode()
    digest = hashlib.sha256(encoded).hexdigest()
    workspace, _ = PersonalSheetWorkspace.objects.select_for_update().get_or_create(sheet=sheet)
    receipt = PersonalSheetWorkspaceReceipt.objects.filter(
        workspace=workspace, idempotency_key=idempotency_key
    ).first()
    if receipt is not None:
        if receipt.request_digest != digest:
            raise PersonalWorkspaceKeyReused()
        return WorkspaceSave(payload=dict(receipt.response_payload), replayed=True)
    if workspace.revision != expected_revision:
        raise PersonalWorkspaceConflict()
    workspace.state = state
    workspace.revision += 1
    workspace.save(update_fields=("state", "revision", "updated_at"))
    payload = {"revision": workspace.revision, "state": workspace.state}
    PersonalSheetWorkspaceReceipt.objects.create(
        workspace=workspace,
        idempotency_key=idempotency_key,
        request_digest=digest,
        response_payload=payload,
    )
    return WorkspaceSave(payload=payload, replayed=False)


@transaction.atomic
def delete_personal_sheets(*, owner: User, sheet_ids: Iterable[UUID]) -> int:
    """Delete the owner's sheets and their files; ids they do not own are ignored."""

    sheets = list(
        PersonalSheet.objects.select_for_update()
        .filter(owner=owner, id__in=list(sheet_ids))
        .select_related("managed_file")
    )
    if not sheets:
        return 0
    from apps.focus.models import FocusAnnotationCollection

    managed_files = [sheet.managed_file for sheet in sheets]
    sheet_ids = [sheet.id for sheet in sheets]
    # The marks belong to the sheet; they go with it, superseded collections first.
    collections = FocusAnnotationCollection.objects.filter(user=owner, document_id__in=sheet_ids)
    collections.filter(merged_into__isnull=False).delete()
    collections.delete()
    PersonalSheet.objects.filter(id__in=sheet_ids).delete()
    for managed_file in managed_files:
        _delete_blob_after_commit(managed_file)
    ManagedFile.objects.filter(id__in=[item.id for item in managed_files]).delete()
    return len(sheets)

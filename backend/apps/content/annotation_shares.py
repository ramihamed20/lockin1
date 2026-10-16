"""Shared marks on a catalog sheet.

A student publishes the marks they made on a sheet; classmates who can open the
same sheet may copy all of them, or only some pages, into a sheet of their own.
The publisher's device sends the whole reader state (ink, text, pictures,
stickers, notes and added pages), so a share is complete even where the server
keeps only part of it for ordinary syncing. A copy is a private sheet that
points at the same catalog file and starts from the chosen marks.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F, QuerySet
from django.utils import timezone

from apps.accounts.models import User
from apps.education.policies import is_content_administrator

from .models import (
    CatalogDocument,
    CatalogSubject,
    PersonalSheet,
    SharedAnnotationImport,
    SharedAnnotationLike,
    SharedAnnotationReport,
    SharedAnnotationSet,
)
from .personal_sheets import TITLE_MAX_LENGTH, visible_subject

NAME_MAX_LENGTH = 80
NOTE_MAX_LENGTH = 500
REASON_MAX_LENGTH = 300
MAX_ANNOTATIONS = 5000
MAX_NOTES = 500
MAX_VIRTUAL_PAGES = 200
MAX_PAGE = 10_000
ANNOTATION_TYPES = frozenset(
    {"pen", "pencil", "highlighter", "shape", "text", "image", "card", "cover"}
)
_IMAGE_DATA_URL = re.compile(r"^data:image/(?:png|jpeg|webp|gif);base64,", re.IGNORECASE)
_WHITESPACE = re.compile(r"\s+")


class AnnotationShareError(ValueError):
    code = "annotation_share_invalid"


class AnnotationShareTooLarge(AnnotationShareError):
    code = "annotation_share_too_large"


class AnnotationShareEmpty(AnnotationShareError):
    code = "annotation_share_empty"


class AnnotationCopyLimitReached(AnnotationShareError):
    code = "annotation_copy_limit_reached"


class AnnotationShareNotFound(LookupError):
    pass


def max_share_bytes() -> int:
    return int(settings.ANNOTATION_SHARE_MAX_BYTES)


def max_copies_per_account() -> int:
    return int(settings.ANNOTATION_COPIES_MAX_PER_ACCOUNT)


def _clean(value: object, limit: int) -> str:
    return _WHITESPACE.sub(" ", str(value or "")).strip()[:limit]


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_virtual(page: object) -> bool:
    return _is_int(page) and page < 0  # type: ignore[operator]


def _is_pdf_page(page: object) -> bool:
    return _is_int(page) and 1 <= page <= MAX_PAGE  # type: ignore[operator]


def clean_snapshot(raw: object) -> dict[str, Any]:
    """Keep only well-formed marks; anything else in the upload is dropped."""

    if not isinstance(raw, dict):
        raise AnnotationShareError("The marks could not be read.")
    virtual_pages: list[dict[str, Any]] = []
    virtual_ids: set[int] = set()
    for item in (raw.get("virtualPages") or [])[:MAX_VIRTUAL_PAGES]:
        if not isinstance(item, dict):
            continue
        page_id, after = item.get("id"), item.get("afterPage")
        if not _is_virtual(page_id) or not _is_pdf_page(after) or page_id in virtual_ids:
            continue
        virtual_ids.add(page_id)
        background = item.get("background")
        virtual_pages.append(
            {
                "id": page_id,
                "afterPage": after,
                "background": (
                    background if background in {"blank", "lined", "grid", "dot"} else "blank"
                ),
            }
        )

    def known_page(page: object) -> bool:
        return _is_pdf_page(page) or (_is_virtual(page) and page in virtual_ids)

    annotations: list[dict[str, Any]] = []
    for item in (raw.get("annotations") or [])[-MAX_ANNOTATIONS:]:
        if not isinstance(item, dict) or item.get("type") not in ANNOTATION_TYPES:
            continue
        if not known_page(item.get("page")) or not isinstance(item.get("id"), str):
            continue
        if item["type"] == "image" and not _IMAGE_DATA_URL.match(str(item.get("src") or "")):
            continue
        annotations.append(item)
    notes = [
        item
        for item in (raw.get("notes") or [])[-MAX_NOTES:]
        if isinstance(item, dict)
        and isinstance(item.get("id"), str)
        and known_page(item.get("page"))
    ]
    return {"annotations": annotations, "notes": notes, "virtualPages": virtual_pages}


def summarize(snapshot: dict[str, Any]) -> tuple[int, list[dict[str, Any]]]:
    """Mark count and the pages that carry marks, in reading order."""

    counts: dict[int, int] = {}
    for item in snapshot["annotations"] + snapshot["notes"]:
        counts[item["page"]] = counts.get(item["page"], 0) + 1
    pages: list[dict[str, Any]] = []
    for page in counts:
        if _is_pdf_page(page):
            pages.append({"key": page, "kind": "pdf", "page": page, "marks": counts[page]})
    for item in snapshot["virtualPages"]:
        pages.append(
            {
                "key": item["id"],
                "kind": "added",
                "page": item["afterPage"],
                "background": item["background"],
                "marks": counts.get(item["id"], 0),
            }
        )
    pages.sort(key=lambda entry: (entry["page"], entry["kind"] == "added"))
    return sum(counts.values()), pages


def filter_snapshot(snapshot: dict[str, Any], *, include: set[int] | None) -> dict[str, Any]:
    """The snapshot limited to chosen pages; `None` keeps everything."""

    if include is None:
        return snapshot
    virtual_pages = [item for item in snapshot["virtualPages"] if item["id"] in include]
    kept_virtual = {item["id"] for item in virtual_pages}

    def keep(item: dict[str, Any]) -> bool:
        page = item["page"]
        return page in kept_virtual if _is_virtual(page) else page in include

    return {
        "annotations": [item for item in snapshot["annotations"] if keep(item)],
        "notes": [item for item in snapshot["notes"] if keep(item)],
        "virtualPages": virtual_pages,
    }


def with_fresh_ids(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Give every copied mark its own id.

    Marks are stored by id across every account, so two students copying the same
    share must not both keep the publisher's ids.
    """

    return {
        **snapshot,
        "annotations": [{**item, "id": str(uuid.uuid4())} for item in snapshot["annotations"]],
        "notes": [{**item, "id": str(uuid.uuid4())} for item in snapshot["notes"]],
    }


def live_sets(document: CatalogDocument) -> QuerySet[SharedAnnotationSet]:
    return SharedAnnotationSet.objects.filter(
        document=document, deleted_at__isnull=True, is_hidden=False
    )


def get_live_set(*, document: CatalogDocument, set_id: uuid.UUID) -> SharedAnnotationSet:
    shared = live_sets(document).filter(id=set_id).first()
    if shared is None:
        raise AnnotationShareNotFound()
    return shared


def own_set(*, owner: User, document: CatalogDocument) -> SharedAnnotationSet | None:
    return SharedAnnotationSet.objects.filter(
        owner=owner, document=document, deleted_at__isnull=True
    ).first()


@transaction.atomic
def publish(
    *,
    owner: User,
    document: CatalogDocument,
    display_name: object,
    anonymous: bool,
    note: object,
    raw_snapshot: object,
    based_on_id: uuid.UUID | None = None,
) -> tuple[SharedAnnotationSet, bool]:
    """Create the owner's share of this sheet, or replace the one they have."""

    snapshot = clean_snapshot(raw_snapshot)
    mark_count, pages = summarize(snapshot)
    if mark_count == 0 and not snapshot["virtualPages"]:
        raise AnnotationShareEmpty("There is nothing on this sheet to share yet.")
    encoded = json.dumps(snapshot, separators=(",", ":"), ensure_ascii=False).encode()
    if len(encoded) > max_share_bytes():
        raise AnnotationShareTooLarge(
            f"Your marks are larger than {max_share_bytes() // (1024 * 1024)} MB."
        )
    name = "" if anonymous else _clean(display_name, NAME_MAX_LENGTH)
    if not anonymous and not name:
        raise AnnotationShareError("Type a name, or share anonymously.")
    based_on = None
    based_name = ""
    if based_on_id is not None:
        based_on = (
            SharedAnnotationSet.objects.filter(id=based_on_id, document=document)
            .exclude(owner=owner)
            .first()
        )
        if based_on is not None and not based_on.is_anonymous:
            based_name = based_on.display_name
    fields = {
        "display_name": name,
        "is_anonymous": anonymous,
        "note": _clean(note, NOTE_MAX_LENGTH),
        "snapshot": snapshot,
        "size_bytes": len(encoded),
        "mark_count": mark_count,
        "marked_pages": pages,
    }
    existing = (
        SharedAnnotationSet.objects.select_for_update()
        .filter(owner=owner, document=document, deleted_at__isnull=True)
        .first()
    )
    if existing is not None:
        for key, value in fields.items():
            setattr(existing, key, value)
        existing.version += 1
        existing.save()
        return existing, False
    try:
        created = SharedAnnotationSet.objects.create(
            document=document,
            owner=owner,
            based_on=based_on,
            based_on_name=based_name,
            **fields,
        )
    except IntegrityError as error:  # a second tab published at the same moment
        raise AnnotationShareError("Your marks were already shared. Try again.") from error
    return created, True


@transaction.atomic
def withdraw(*, shared: SharedAnnotationSet) -> None:
    """Take a share down. People who copied it keep their copies and are told."""

    shared.deleted_at = timezone.now()
    shared.snapshot = {}
    shared.marked_pages = []
    shared.size_bytes = 0
    shared.save(
        update_fields=("deleted_at", "snapshot", "marked_pages", "size_bytes", "updated_at")
    )


@transaction.atomic
def set_like(*, shared: SharedAnnotationSet, user: User, liked: bool) -> int:
    if liked:
        _, created = SharedAnnotationLike.objects.get_or_create(shared_set=shared, user=user)
        if created:
            SharedAnnotationSet.objects.filter(id=shared.id).update(like_count=F("like_count") + 1)
    else:
        removed, _ = SharedAnnotationLike.objects.filter(shared_set=shared, user=user).delete()
        if removed:
            SharedAnnotationSet.objects.filter(id=shared.id, like_count__gt=0).update(
                like_count=F("like_count") - 1
            )
    return int(SharedAnnotationSet.objects.values_list("like_count", flat=True).get(id=shared.id))


@transaction.atomic
def report(*, shared: SharedAnnotationSet, reporter: User, reason: object) -> None:
    _, created = SharedAnnotationReport.objects.get_or_create(
        shared_set=shared,
        reporter=reporter,
        defaults={"reason": _clean(reason, REASON_MAX_LENGTH)},
    )
    if created:
        SharedAnnotationSet.objects.filter(id=shared.id).update(report_count=F("report_count") + 1)


def author_label(shared: SharedAnnotationSet) -> str:
    return "" if shared.is_anonymous else shared.display_name


def copies_in_use(owner: User) -> int:
    return PersonalSheet.objects.filter(owner=owner, source_document__isnull=False).count()


def _unique_title(*, owner: User, subject: CatalogSubject, base: str) -> str:
    base = base[:TITLE_MAX_LENGTH].strip()
    taken = {
        title.lower()
        for title in PersonalSheet.objects.filter(owner=owner, subject=subject).values_list(
            "title", flat=True
        )
    }
    if base.lower() not in taken:
        return base
    for number in range(2, 200):
        suffix = f" ({number})"
        candidate = f"{base[: TITLE_MAX_LENGTH - len(suffix)].strip()}{suffix}"
        if candidate.lower() not in taken:
            return candidate
    return f"{base[: TITLE_MAX_LENGTH - 9].strip()} {uuid.uuid4().hex[:8]}"


@transaction.atomic
def import_share(
    *,
    user: User,
    document: CatalogDocument,
    shared: SharedAnnotationSet,
    include: set[int] | None,
) -> PersonalSheet:
    """Copy a share (or some of its pages) into a new private sheet."""

    subject = visible_subject(user=user, material_slug=document.material_slug)
    if subject is None:
        raise AnnotationShareNotFound()
    User.objects.select_for_update().filter(id=user.id).first()
    if copies_in_use(user) >= max_copies_per_account():
        raise AnnotationCopyLimitReached(
            f"You can keep up to {max_copies_per_account()} copies of other students' marks."
        )
    snapshot = with_fresh_ids(filter_snapshot(shared.snapshot, include=include))
    label = author_label(shared) or "Anonymous"
    title = _unique_title(owner=user, subject=subject, base=f"{document.version.title} - {label}")
    sheet = PersonalSheet.objects.create(
        owner=user,
        subject=subject,
        managed_file=document.managed_file,
        title=title,
        page_count=document.managed_file.pdf_page_count,
        source_document=document,
        source_set=shared,
        copy_author=author_label(shared),
        seed=snapshot,
    )
    SharedAnnotationImport.objects.update_or_create(
        shared_set=shared,
        user=user,
        defaults={
            "imported_version": shared.version,
            "dismissed_version": 0,
            "dismissed_removal": False,
        },
    )
    return sheet


@dataclass(frozen=True, slots=True)
class Notice:
    kind: str  # "updated" or "removed"
    share_id: uuid.UUID
    author: str
    version: int


def notices(*, user: User, document: CatalogDocument) -> list[Notice]:
    """What changed in the shares this student has copied from this sheet."""

    found: list[Notice] = []
    imports = SharedAnnotationImport.objects.filter(
        user=user, shared_set__document=document
    ).select_related("shared_set")
    for record in imports:
        shared = record.shared_set
        if shared.deleted_at is not None or shared.is_hidden:
            if not record.dismissed_removal:
                found.append(Notice("removed", shared.id, author_label(shared), shared.version))
        elif shared.version > record.imported_version and record.dismissed_version < shared.version:
            found.append(Notice("updated", shared.id, author_label(shared), shared.version))
    return found


def dismiss(*, user: User, share_id: uuid.UUID) -> None:
    record = (
        SharedAnnotationImport.objects.filter(user=user, shared_set_id=share_id)
        .select_related("shared_set")
        .first()
    )
    if record is None:
        return
    shared = record.shared_set
    if shared.deleted_at is not None or shared.is_hidden:
        record.dismissed_removal = True
    else:
        record.dismissed_version = shared.version
    record.save(update_fields=("dismissed_removal", "dismissed_version", "updated_at"))


def copies_of(*, user: User, document: CatalogDocument) -> QuerySet[PersonalSheet]:
    """The student's own copies of other students' marks on this sheet, newest first."""

    return PersonalSheet.objects.filter(owner=user, source_document=document).order_by(
        "-created_at", "-id"
    )


def can_moderate(user: User) -> bool:
    return bool(is_content_administrator(user))

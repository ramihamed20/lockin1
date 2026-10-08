"""Practice: typing the name of a slide.

Administrators build a set of image slides in order and give each one the name
a student must type. A set belongs to one subject and reaches the students of
that subject's cohort once it is published. The answers never leave the server
until a student has tried a slide, so the check is made here.
"""

from __future__ import annotations

import logging
import re
import unicodedata
import zipfile
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile, UploadedFile
from django.db import IntegrityError, transaction
from django.db.models import Count, Q, QuerySet
from django.utils import timezone

from apps.accounts.models import User
from apps.education.policies import is_content_administrator
from apps.files.models import ManagedFile
from apps.files.services import FileValidationError, create_managed_file
from apps.xp.services import award_xp

from .models import CatalogSubject, PracticeSet, PracticeSlide, PracticeSlideProgress

logger = logging.getLogger("lockin.catalog")

TITLE_MAX_LENGTH = 120
ANSWER_MAX_LENGTH = 200

# Stable rule codes: a slide or set can only ever earn its award once per student,
# whatever the points are later changed to.
SLIDE_XP_RULE = "practice_slide_v1"
SET_XP_RULE = "practice_set_complete_v1"
SLIDE_XP_CLEAN = 5
SLIDE_XP_HINTED = 3
SET_XP_COMPLETE = 20

# Days until a slide that was named cleanly comes back for review, by streak.
REVIEW_DAYS = {1: 1, 2: 3, 3: 7}
REVIEW_DAYS_MASTERED = 21

HOTSPOT_SHAPES = ("circle", "arrow")
MOST_MISSED_LIMIT = 5


class PracticeError(ValueError):
    code = "practice_invalid"


class PracticeTitleTaken(PracticeError):
    code = "practice_title_taken"


class PracticeNotReady(PracticeError):
    code = "practice_not_ready"


def max_slides_per_set() -> int:
    return int(settings.PRACTICE_SLIDES_MAX_PER_SET)


def normalize_title(value: object) -> str:
    title = " ".join(str(value or "").split())
    if not title:
        raise PracticeError("Give the set a name.")
    if len(title) > TITLE_MAX_LENGTH:
        raise PracticeError(f"Keep the name under {TITLE_MAX_LENGTH} characters.")
    return title


def normalize_answer(value: object) -> str:
    """The form two answers are compared in.

    Letter case and spaces are the only differences Practice forgives, so this
    folds case and drops every space. Invisible format characters (direction
    marks, zero-width spaces) are dropped too: nobody typed them on purpose.
    Spelling, accents and punctuation all stay exactly as they were.
    """

    text = unicodedata.normalize("NFC", str(value or ""))
    kept = (char for char in text if not char.isspace() and unicodedata.category(char) != "Cf")
    return "".join(kept).casefold()


def clean_answer(value: object) -> str:
    """An answer as stored: trimmed and with single spaces, otherwise untouched."""

    answer = " ".join(str(value or "").split())
    if len(answer) > ANSWER_MAX_LENGTH:
        raise PracticeError(f"Keep each answer under {ANSWER_MAX_LENGTH} characters.")
    return answer


def is_correct(*, typed: object, expected: str) -> bool:
    folded = normalize_answer(expected)
    return bool(folded) and normalize_answer(typed) == folded


def _within_edits(left: str, right: str, limit: int) -> bool:
    """Whether the strings differ by at most ``limit`` inserts, deletes, swaps or changes."""

    if abs(len(left) - len(right)) > limit:
        return False
    previous: list[int] = []
    before: list[int] = []
    row = list(range(len(right) + 1))
    for i, a in enumerate(left, start=1):
        before, previous, row = previous, row, [i] + [0] * len(right)
        for j, b in enumerate(right, start=1):
            cost = 0 if a == b else 1
            row[j] = min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost)
            if i > 1 and j > 1 and a == right[j - 2] and left[i - 2] == b:
                row[j] = min(row[j], before[j - 2] + 1)
    return row[len(right)] <= limit


def is_near_miss(*, typed: object, expected: str) -> bool:
    """A wrong answer that is only a typo away. It only changes the wording of the hint."""

    target = normalize_answer(expected)
    attempt = normalize_answer(typed)
    if len(target) < 4 or not attempt or attempt == target:
        return False
    return _within_edits(attempt, target, 1 if len(target) < 12 else 2)


def first_letter(answer: str) -> str:
    """The first character of an answer with any combining marks that belong to it."""

    text = answer.strip()
    if not text:
        return ""
    end = 1
    while end < len(text) and unicodedata.category(text[end]) in {"Mn", "Me"}:
        end += 1
    return text[:end]


# --- Students ---------------------------------------------------------------


def cohort_subjects(user: User) -> QuerySet[CatalogSubject]:
    subjects = CatalogSubject.objects.filter(is_active=True)
    if is_content_administrator(user):
        return subjects
    cohort = user.cohort
    if cohort is None or not cohort.is_active:
        return subjects.none()
    return subjects.filter(cohort_id=cohort.id)


def published_sets(user: User) -> QuerySet[PracticeSet]:
    return (
        PracticeSet.objects.filter(is_published=True, subject__in=cohort_subjects(user))
        .annotate(slide_count=Count("slides"))
        .filter(slide_count__gt=0)
        .select_related("subject")
        .order_by("subject__position", "subject__title", "created_at", "id")
    )


def visible_set(*, user: User, set_id: UUID) -> PracticeSet | None:
    """A published set of the student's cohort; administrators may also preview a draft."""

    if is_content_administrator(user):
        return (
            PracticeSet.objects.filter(id=set_id, subject__in=cohort_subjects(user))
            .annotate(slide_count=Count("slides"))
            .filter(slide_count__gt=0)
            .select_related("subject")
            .first()
        )
    return published_sets(user).filter(id=set_id).first()


def _review_due(streak: int, now: datetime) -> datetime:
    return now + timedelta(days=REVIEW_DAYS.get(streak, REVIEW_DAYS_MASTERED))


def slide_state(progress: PracticeSlideProgress | None, now: datetime) -> str:
    """new, missed (last try wrong), due (right, but time to look again) or learned."""

    if progress is None or progress.attempts == 0:
        return "new"
    if not progress.last_correct:
        return "missed"
    if progress.due_at is not None and progress.due_at <= now:
        return "due"
    return "learned"


def progress_by_slide(
    *, user: User, practice_set: PracticeSet
) -> dict[UUID, PracticeSlideProgress]:
    rows = PracticeSlideProgress.objects.filter(user=user, slide__practice_set=practice_set)
    return {row.slide_id: row for row in rows}


def set_stats(*, user: User, sets: Iterable[PracticeSet]) -> dict[UUID, dict[str, Any]]:
    """Per set: how many slides are in each state, and when the student last practised."""

    by_id = {item.id: item for item in sets}
    now = timezone.now()
    stats: dict[UUID, dict[str, Any]] = {
        set_id: {
            "total": int(getattr(item, "slide_count", 0)),
            "new": 0,
            "missed": 0,
            "due": 0,
            "learned": 0,
            "last_practiced_at": None,
        }
        for set_id, item in by_id.items()
    }
    rows = PracticeSlideProgress.objects.filter(
        user=user, slide__practice_set_id__in=list(by_id), attempts__gt=0
    ).select_related("slide")
    for row in rows:
        entry = stats[row.slide.practice_set_id]
        entry[slide_state(row, now)] += 1
        if row.last_attempt_at and (
            entry["last_practiced_at"] is None or row.last_attempt_at > entry["last_practiced_at"]
        ):
            entry["last_practiced_at"] = row.last_attempt_at
    for entry in stats.values():
        entry["new"] = max(entry["total"] - entry["missed"] - entry["due"] - entry["learned"], 0)
        entry["review"] = entry["missed"] + entry["due"]
        stamp = entry["last_practiced_at"]
        entry["last_practiced_at"] = stamp.isoformat() if stamp else None
    return stats


def most_missed(*, user: User, practice_set: PracticeSet) -> list[tuple[PracticeSlide, int]]:
    """The slides this student gets wrong most, with how often, for the set's overview."""

    rows = (
        PracticeSlideProgress.objects.filter(
            user=user, slide__practice_set=practice_set, miss_count__gt=0
        )
        .select_related("slide")
        .order_by("-miss_count", "slide__position")[:MOST_MISSED_LIMIT]
    )
    return [(row.slide, row.miss_count) for row in rows]


@dataclass(frozen=True, slots=True)
class CheckResult:
    correct: bool
    expected: str
    near_miss: bool
    hinted: bool
    xp_awarded: int
    set_xp_awarded: int


def _award(
    *,
    user: User,
    source_key: str,
    rule: str,
    points: int,
    reason: str,
    object_id: UUID,
    now: datetime,
) -> int:
    award, created = award_xp(
        user_id=user.id,
        source_key=source_key,
        source_event_id=None,
        source_event_name="content.practice.slide_named",
        source_object_id=object_id,
        rule_code=rule,
        points=points,
        category="learning",
        reason=reason,
        occurred_at=now,
        ranking_eligible=True,
    )
    return award.points if created else 0


def check_attempt(
    *, user: User, practice_set: PracticeSet, slide: PracticeSlide, typed: object
) -> CheckResult:
    """Grade one try, remember it for review, and pay the one-time XP for a first correct name.

    The XP ledger keys the award on the student and the slide, so repeating a
    slide, a retried request or a second tab can never pay twice. A hint taken
    for this try lowers the award and does not lengthen the review streak.
    An administrator previewing a draft is graded but nothing is recorded.
    """

    correct = is_correct(typed=typed, expected=slide.answer)
    near = not correct and is_near_miss(typed=typed, expected=slide.answer)
    if not practice_set.is_published:
        return CheckResult(correct, slide.answer, near, False, 0, 0)

    now = timezone.now()
    xp = set_xp = 0
    with transaction.atomic():
        progress, _ = PracticeSlideProgress.objects.select_for_update().get_or_create(
            user=user, slide=slide
        )
        hinted = progress.hint_pending
        progress.attempts += 1
        progress.last_attempt_at = now
        progress.last_correct = correct
        progress.hint_pending = False
        if correct:
            if not hinted:
                progress.streak = min(progress.streak + 1, 250)
            progress.due_at = _review_due(progress.streak, now)
        else:
            progress.miss_count += 1
            progress.streak = 0
            progress.due_at = now
        progress.save()
        if correct:
            xp = _award(
                user=user,
                source_key=f"practice-slide:{user.id}:{slide.id}",
                rule=SLIDE_XP_RULE,
                points=SLIDE_XP_HINTED if hinted else SLIDE_XP_CLEAN,
                reason="Practice slide named",
                object_id=slide.id,
                now=now,
            )
            named = PracticeSlideProgress.objects.filter(
                user=user, slide__practice_set=practice_set, last_correct=True
            ).count()
            if named >= practice_set.slides.count():
                set_xp = _award(
                    user=user,
                    source_key=f"practice-set:{user.id}:{practice_set.id}",
                    rule=SET_XP_RULE,
                    points=SET_XP_COMPLETE,
                    reason="Practice set completed",
                    object_id=practice_set.id,
                    now=now,
                )
    return CheckResult(correct, slide.answer, near, hinted, xp, set_xp)


def reveal_hint(*, user: User, practice_set: PracticeSet, slide: PracticeSlide) -> str:
    """The first letter of the name. Taking it marks the next check as hinted."""

    letter = first_letter(slide.answer)
    if practice_set.is_published and letter:
        with transaction.atomic():
            progress, _ = PracticeSlideProgress.objects.select_for_update().get_or_create(
                user=user, slide=slide
            )
            if not progress.hint_pending:
                progress.hint_pending = True
                progress.save(update_fields=["hint_pending"])
    return letter


def can_view_practice_image(*, user: User, managed_file_id: UUID) -> bool:
    return PracticeSlide.objects.filter(
        managed_file_id=managed_file_id,
        practice_set__is_published=True,
        practice_set__subject__in=cohort_subjects(user),
    ).exists()


# --- Administrators ---------------------------------------------------------


def admin_sets(subject: CatalogSubject) -> QuerySet[PracticeSet]:
    return (
        PracticeSet.objects.filter(subject=subject)
        .annotate(
            slide_count=Count("slides", distinct=True),
            answered_count=Count("slides", filter=~Q(slides__answer=""), distinct=True),
        )
        .order_by("created_at", "id")
    )


def create_set(*, subject: CatalogSubject, title: object, actor: User) -> PracticeSet:
    normalized = normalize_title(title)
    taken = "This subject already has a set with this name."
    try:
        with transaction.atomic():
            if PracticeSet.objects.filter(subject=subject, title__iexact=normalized).exists():
                raise PracticeTitleTaken(taken)
            return PracticeSet.objects.create(subject=subject, title=normalized, created_by=actor)
    except IntegrityError as error:
        raise PracticeTitleTaken(taken) from error


def _check_publishable(practice_set: PracticeSet) -> None:
    answers = list(practice_set.slides.values_list("answer", flat=True))
    if not answers:
        raise PracticeNotReady("Add at least one slide before publishing.")
    missing = sum(1 for answer in answers if not normalize_answer(answer))
    if missing:
        raise PracticeNotReady(
            f"{missing} slide{'s' if missing != 1 else ''} still need an answer before publishing."
        )


@transaction.atomic
def update_set(
    *, practice_set: PracticeSet, title: object | None = None, is_published: bool | None = None
) -> PracticeSet:
    locked = PracticeSet.objects.select_for_update().get(id=practice_set.id)
    if title is not None:
        normalized = normalize_title(title)
        if (
            PracticeSet.objects.filter(subject_id=locked.subject_id, title__iexact=normalized)
            .exclude(id=locked.id)
            .exists()
        ):
            raise PracticeTitleTaken("This subject already has a set with this name.")
        locked.title = normalized
    if is_published is not None:
        if is_published:
            _check_publishable(locked)
        locked.is_published = is_published
    locked.save()
    return locked


def _delete_blob_after_commit(managed_file: ManagedFile) -> None:
    storage = managed_file.blob.storage
    name = managed_file.blob.name

    def delete() -> None:
        if not name:
            return
        try:
            storage.delete(name)
        except Exception:  # noqa: BLE001 - a stray object must not fail a saved change
            logger.warning("Practice image blob could not be deleted", exc_info=True)

    transaction.on_commit(delete)


def _discard_rejected_upload(managed_file: ManagedFile) -> None:
    # The surrounding transaction rolls the row back, and any on_commit hook
    # with it, so the stored bytes are removed here or never.
    name = managed_file.blob.name
    if not name:
        return
    try:
        managed_file.blob.storage.delete(name)
    except Exception:  # noqa: BLE001 - the rejection is still reported
        logger.warning("Rejected practice image blob could not be deleted", exc_info=True)


@transaction.atomic
def delete_set(practice_set: PracticeSet) -> None:
    files = [slide.managed_file for slide in practice_set.slides.select_related("managed_file")]
    practice_set.delete()
    for managed_file in files:
        _delete_blob_after_commit(managed_file)
    ManagedFile.objects.filter(id__in=[item.id for item in files]).delete()


def ordered_slides(practice_set: PracticeSet) -> list[PracticeSlide]:
    return list(
        practice_set.slides.select_related("managed_file").order_by("position", "created_at", "id")
    )


def _renumber(practice_set: PracticeSet) -> None:
    slides = practice_set.slides.order_by("position", "created_at", "id")
    for index, slide in enumerate(slides, start=1):
        if slide.position != index:
            PracticeSlide.objects.filter(id=slide.id).update(position=index)


def _unpublish_if_incomplete(practice_set: PracticeSet) -> None:
    current = PracticeSet.objects.filter(id=practice_set.id, is_published=True).first()
    if current is None:
        return
    try:
        _check_publishable(current)
    except PracticeNotReady:
        PracticeSet.objects.filter(id=current.id).update(is_published=False)


@dataclass(frozen=True, slots=True)
class UploadOutcome:
    added: list[PracticeSlide]
    rejected: list[tuple[str, str]]


def add_slides(
    *, practice_set: PracticeSet, uploads: Sequence[UploadedFile], owner: User
) -> UploadOutcome:
    """Append images to the end of the set in the order they were chosen.

    An image that fails validation is reported by name and the rest still go
    in. Each image is its own transaction so one bad file never loses the others.
    """

    added: list[PracticeSlide] = []
    rejected: list[tuple[str, str]] = []
    for upload in uploads:
        name = str(upload.name or "image")
        try:
            with transaction.atomic():
                locked = PracticeSet.objects.select_for_update().get(id=practice_set.id)
                if locked.slides.count() >= max_slides_per_set():
                    raise PracticeError(f"A set holds up to {max_slides_per_set()} slides.")
                try:
                    managed_file = create_managed_file(
                        owner=owner, upload=upload, kind=ManagedFile.Kind.PRACTICE_IMAGE
                    )
                except FileValidationError as error:
                    raise PracticeError(str(error)) from error
                try:
                    last = (
                        locked.slides.order_by("-position")
                        .values_list("position", flat=True)
                        .first()
                        or 0
                    )
                    slide = PracticeSlide.objects.create(
                        practice_set=locked, managed_file=managed_file, position=last + 1
                    )
                except Exception:
                    _discard_rejected_upload(managed_file)
                    raise
                # A new slide has no answer yet, so a published set is no longer complete.
                _unpublish_if_incomplete(locked)
                added.append(slide)
        except PracticeError as error:
            rejected.append((name, str(error)))
    return UploadOutcome(added=added, rejected=rejected)


ARCHIVE_MAX_BYTES = 80 * 1024 * 1024
ARCHIVE_UNPACKED_MAX_BYTES = 400 * 1024 * 1024
ARCHIVE_IMAGE_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _natural_key(name: str) -> list[tuple[int, int | str]]:
    return [
        (0, int(part)) if part.isdigit() else (1, part)
        for part in re.split(r"(\d+)", name.casefold())
        if part
    ]


def _is_archive_junk(path: str, base: str) -> bool:
    parts = path.split("/")
    return (
        "__MACOSX" in parts
        or base.startswith(".")
        or base.casefold() in {"thumbs.db", "desktop.ini"}
    )


def add_slides_from_archive(
    *, practice_set: PracticeSet, archive: UploadedFile, owner: User
) -> UploadOutcome:
    """Append every image inside a ZIP, in natural file-name order (Image2 before Image10)."""

    if archive.size is not None and archive.size > ARCHIVE_MAX_BYTES:
        raise PracticeError(f"The ZIP is larger than {ARCHIVE_MAX_BYTES // 1024 // 1024} MB.")
    try:
        bundle = zipfile.ZipFile(archive)
    except (zipfile.BadZipFile, OSError) as error:
        raise PracticeError("That file is not a valid ZIP archive.") from error

    max_bytes = int(settings.PRACTICE_IMAGE_MAX_BYTES)
    rejected: list[tuple[str, str]] = []
    entries: list[tuple[str, zipfile.ZipInfo]] = []
    with bundle:
        infos = [info for info in bundle.infolist() if not info.is_dir()]
        if sum(info.file_size for info in infos) > ARCHIVE_UNPACKED_MAX_BYTES:
            raise PracticeError("The ZIP unpacks to more than 400 MB.")
        for info in infos:
            path = info.filename.replace("\\", "/")
            base = path.rsplit("/", 1)[-1]
            if _is_archive_junk(path, base):
                continue
            suffix = "." + base.rsplit(".", 1)[-1].casefold() if "." in base else ""
            if suffix not in ARCHIVE_IMAGE_TYPES:
                rejected.append((base, "Only JPEG, PNG or WebP images are accepted."))
            elif info.flag_bits & 0x1:
                rejected.append((base, "Password-protected files cannot be read."))
            elif info.file_size > max_bytes:
                rejected.append((base, f"Larger than {max_bytes // 1024 // 1024} MB."))
            else:
                entries.append((path, info))
        if not entries and not rejected:
            raise PracticeError("The ZIP has no images in it.")

        entries.sort(key=lambda item: (_natural_key(item[0].rsplit("/", 1)[-1]), item[0]))
        room = max(0, max_slides_per_set() - practice_set.slides.count())
        for path, _ in entries[room:]:
            rejected.append(
                (path.rsplit("/", 1)[-1], f"A set holds up to {max_slides_per_set()} slides.")
            )
        added: list[PracticeSlide] = []
        for path, info in entries[:room]:
            base = path.rsplit("/", 1)[-1]
            suffix = "." + base.rsplit(".", 1)[-1].casefold()
            with bundle.open(info) as handle:
                data = handle.read(max_bytes + 1)
            if len(data) > max_bytes:
                rejected.append((base, f"Larger than {max_bytes // 1024 // 1024} MB."))
                continue
            outcome = add_slides(
                practice_set=practice_set,
                uploads=[SimpleUploadedFile(base, data, content_type=ARCHIVE_IMAGE_TYPES[suffix])],
                owner=owner,
            )
            added.extend(outcome.added)
            rejected.extend(outcome.rejected)
    return UploadOutcome(added=added, rejected=rejected)


@transaction.atomic
def set_slide_answer(*, slide: PracticeSlide, answer: object) -> PracticeSlide:
    cleaned = clean_answer(answer)
    locked = PracticeSlide.objects.select_for_update().get(id=slide.id)
    locked.answer = cleaned
    locked.save(update_fields=["answer"])
    if not normalize_answer(cleaned):
        _unpublish_if_incomplete(locked.practice_set)
    return locked


@transaction.atomic
def set_answers_in_order(*, practice_set: PracticeSet, answers: Sequence[object]) -> int:
    """Apply a list of answers to the slides by position. A blank entry keeps what is there."""

    PracticeSet.objects.select_for_update().get(id=practice_set.id)
    slides = list(practice_set.slides.order_by("position", "created_at", "id"))
    if len(answers) > len(slides):
        raise PracticeError(
            f"The list has {len(answers)} answers but the set has only {len(slides)} slides."
        )
    cleaned = [clean_answer(answer) for answer in answers]
    changed = 0
    for slide, answer in zip(slides, cleaned, strict=False):
        if answer and answer != slide.answer:
            slide.answer = answer
            slide.save(update_fields=["answer"])
            changed += 1
    return changed


@transaction.atomic
def delete_slide(slide: PracticeSlide) -> None:
    practice_set = slide.practice_set
    managed_file = slide.managed_file
    slide.delete()
    _delete_blob_after_commit(managed_file)
    ManagedFile.objects.filter(id=managed_file.id).delete()
    _renumber(practice_set)
    if not practice_set.slides.exists():
        PracticeSet.objects.filter(id=practice_set.id).update(is_published=False)


@transaction.atomic
def reorder_slides(*, practice_set: PracticeSet, ordered_ids: Iterable[UUID]) -> None:
    PracticeSet.objects.select_for_update().get(id=practice_set.id)
    wanted = list(ordered_ids)
    current = set(practice_set.slides.values_list("id", flat=True))
    if len(wanted) != len(set(wanted)) or set(wanted) != current:
        raise PracticeError("The order must list every slide of the set exactly once.")
    for index, slide_id in enumerate(wanted, start=1):
        PracticeSlide.objects.filter(id=slide_id).update(position=index)


@transaction.atomic
def set_slide_hotspot(
    *, slide: PracticeSlide, x: float | None, y: float | None, shape: str = ""
) -> PracticeSlide:
    """Mark where on the image the question points, or clear the mark with ``x=None``."""

    locked = PracticeSlide.objects.select_for_update().get(id=slide.id)
    if x is None or y is None:
        locked.hotspot_x = locked.hotspot_y = None
        locked.hotspot_shape = ""
    else:
        if not (0 <= x <= 1 and 0 <= y <= 1):
            raise PracticeError("The mark has to sit on the image.")
        if shape not in HOTSPOT_SHAPES:
            raise PracticeError("Choose a circle or an arrow.")
        locked.hotspot_x, locked.hotspot_y, locked.hotspot_shape = round(x, 4), round(y, 4), shape
    locked.save(update_fields=["hotspot_x", "hotspot_y", "hotspot_shape"])
    return locked


@transaction.atomic
def move_slide(*, practice_set: PracticeSet, slide: PracticeSlide, position: int) -> None:
    """Put a slide at a 1-based position; the others keep their relative order."""

    PracticeSet.objects.select_for_update().get(id=practice_set.id)
    ids = list(
        practice_set.slides.order_by("position", "created_at", "id").values_list("id", flat=True)
    )
    if slide.id not in ids:
        raise PracticeError("That slide is not in this set.")
    if not 1 <= position <= len(ids):
        raise PracticeError(f"Choose a position from 1 to {len(ids)}.")
    ids.remove(slide.id)
    ids.insert(position - 1, slide.id)
    for index, slide_id in enumerate(ids, start=1):
        PracticeSlide.objects.filter(id=slide_id).update(position=index)


@transaction.atomic
def replace_slide_image(
    *, slide: PracticeSlide, upload: UploadedFile, owner: User
) -> PracticeSlide:
    """Swap the picture and keep the slide's name, position and mark."""

    locked = (
        PracticeSlide.objects.select_for_update().select_related("managed_file").get(id=slide.id)
    )
    try:
        fresh = create_managed_file(
            owner=owner, upload=upload, kind=ManagedFile.Kind.PRACTICE_IMAGE
        )
    except FileValidationError as error:
        raise PracticeError(str(error)) from error
    previous = locked.managed_file
    try:
        locked.managed_file = fresh
        locked.save(update_fields=["managed_file"])
    except Exception:
        _discard_rejected_upload(fresh)
        raise
    _delete_blob_after_commit(previous)
    ManagedFile.objects.filter(id=previous.id).delete()
    return locked


def _copy_title(subject_id: UUID, source_title: str) -> str:
    taken = {
        title.casefold()
        for title in PracticeSet.objects.filter(subject_id=subject_id).values_list(
            "title", flat=True
        )
    }
    for attempt in range(1, 100):
        suffix = "" if attempt == 1 else f" {attempt}"
        label = f"Copy of {source_title}"
        candidate = label[: TITLE_MAX_LENGTH - len(suffix)].rstrip() + suffix
        if candidate.casefold() not in taken:
            return candidate
    raise PracticeTitleTaken("Rename the existing copies first.")


def duplicate_set(*, source: PracticeSet, actor: User, title: object | None = None) -> PracticeSet:
    """A draft copy of a set with its own copy of every image, names, marks and order."""

    name = normalize_title(title) if title else _copy_title(source.subject_id, source.title)
    copy = create_set(subject=source.subject, title=name, actor=actor)
    try:
        for slide in ordered_slides(source):
            original = slide.managed_file
            try:
                original.blob.open("rb")
                try:
                    data = original.blob.read()
                finally:
                    original.blob.close()
            except Exception as error:  # noqa: BLE001 - any storage failure aborts the copy
                raise PracticeError(
                    "An image of this set could not be read for copying."
                ) from error
            upload = SimpleUploadedFile(
                original.original_name, data, content_type=original.content_type
            )
            with transaction.atomic():
                try:
                    fresh = create_managed_file(
                        owner=actor, upload=upload, kind=ManagedFile.Kind.PRACTICE_IMAGE
                    )
                except FileValidationError as error:
                    raise PracticeError(str(error)) from error
                try:
                    PracticeSlide.objects.create(
                        practice_set=copy,
                        managed_file=fresh,
                        position=slide.position,
                        answer=slide.answer,
                        hotspot_x=slide.hotspot_x,
                        hotspot_y=slide.hotspot_y,
                        hotspot_shape=slide.hotspot_shape,
                    )
                except Exception:
                    _discard_rejected_upload(fresh)
                    raise
    except Exception:
        delete_set(copy)
        raise
    return copy

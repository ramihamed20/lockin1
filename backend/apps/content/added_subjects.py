"""Subjects a Second Year Dentistry student adds from First Year.

A student's Catalog is their cohort's subjects. A Second Year Dentistry student
may also add up to ``ADDED_SUBJECT_LIMIT`` subjects from First Year of the same
program -- a subject they are carrying or repeating. Every student-facing scope
reads ``student_subjects`` so Materials, Questions, Practice, personal sheets,
offline and document access all agree on what the student owns.

Eligibility is evaluated on every read rather than stored: a student who moves
to another cohort keeps their rows, but they stop granting anything.
"""

from __future__ import annotations

from uuid import UUID

from django.db import transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.accounts.models import User
from apps.education.models import StudentCohort
from apps.education.policies import is_content_administrator

from .models import AddedCatalogSubject, AddedSubjectChangeRequest, CatalogSubject

ADDED_SUBJECT_LIMIT = 2

_SOURCE_YEAR = "year-1"
_TARGET_YEAR = "year-2"
_PROGRAM_PREFIX = "dentistry"


class AddedSubjectError(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def _active_cohort(user: User) -> StudentCohort | None:
    cohort = user.cohort
    if cohort is None or not cohort.is_active:
        return None
    return cohort


def can_add_subjects(user: User) -> bool:
    cohort = _active_cohort(user)
    return bool(
        cohort is not None
        and cohort.code == _TARGET_YEAR
        and str(cohort.program.code).startswith(_PROGRAM_PREFIX)
    )


def addable_subjects(user: User) -> QuerySet[CatalogSubject]:
    """First Year subjects of the student's own program."""

    cohort = _active_cohort(user)
    if cohort is None or not can_add_subjects(user):
        return CatalogSubject.objects.none()
    return CatalogSubject.objects.filter(
        is_active=True,
        cohort__is_active=True,
        cohort__program_id=cohort.program_id,
        cohort__code=_SOURCE_YEAR,
    ).order_by("position", "title", "id")


def added_subjects(user: User) -> QuerySet[CatalogSubject]:
    """The subjects this student added that still grant access."""

    return addable_subjects(user).filter(student_additions__user=user)


def student_subjects(user: User) -> QuerySet[CatalogSubject]:
    """Every active branch this reader may study.

    Content administrators see every branch; a student sees their cohort's
    branches plus the ones they added.
    """

    subjects = CatalogSubject.objects.filter(is_active=True)
    if is_content_administrator(user):
        return subjects
    cohort = _active_cohort(user)
    if cohort is None:
        return subjects.none()
    added_ids = list(added_subjects(user).values_list("id", flat=True))
    return subjects.filter(Q(cohort_id=cohort.id) | Q(id__in=added_ids))


def _pending_request(user: User) -> AddedSubjectChangeRequest | None:
    return (
        AddedSubjectChangeRequest.objects.filter(
            user=user, status=AddedSubjectChangeRequest.Status.PENDING
        )
        .select_related("remove_subject", "add_subject")
        .first()
    )


def change_request_payload(item: AddedSubjectChangeRequest) -> dict[str, object]:
    return {
        "id": str(item.id),
        "status": item.status,
        "remove": {"slug": item.remove_subject.material_slug, "title": item.remove_subject.title},
        "add": {"slug": item.add_subject.material_slug, "title": item.add_subject.title},
        "note": item.note,
        "admin_note": item.admin_note,
        "created_at": item.created_at.isoformat(),
        "decided_at": item.decided_at.isoformat() if item.decided_at else None,
    }


def added_subject_payload(user: User) -> dict[str, object]:
    eligible = can_add_subjects(user)
    added = set(added_subjects(user).values_list("material_slug", flat=True)) if eligible else set()
    pending = _pending_request(user) if eligible else None
    return {
        "eligible": eligible,
        "limit": ADDED_SUBJECT_LIMIT,
        "added": sorted(added),
        "available": [
            {
                "slug": subject.material_slug,
                "title": subject.title,
                "added": subject.material_slug in added,
            }
            for subject in addable_subjects(user)
        ],
        "pending_request": change_request_payload(pending) if pending else None,
    }


@transaction.atomic
def add_subject(*, user: User, material_slug: str) -> None:
    if not can_add_subjects(user):
        raise AddedSubjectError("Your year cannot add subjects.", "not_eligible")
    # Serialise this student's additions so two requests cannot both pass the
    # limit check.
    User.objects.select_for_update().filter(pk=user.pk).first()
    subject = addable_subjects(user).filter(material_slug=material_slug).first()
    if subject is None:
        raise AddedSubjectError("This subject cannot be added.", "subject_not_addable")
    if added_subjects(user).filter(id=subject.id).exists():
        return
    if added_subjects(user).count() >= ADDED_SUBJECT_LIMIT:
        raise AddedSubjectError(
            f"You can add up to {ADDED_SUBJECT_LIMIT} subjects.", "added_subject_limit"
        )
    AddedCatalogSubject.objects.get_or_create(user=user, subject=subject)


@transaction.atomic
def request_change(
    *, user: User, remove_slug: str, add_slug: str, note: str = ""
) -> AddedSubjectChangeRequest:
    """Ask to swap an added subject. Added subjects are final once chosen."""

    if not can_add_subjects(user):
        raise AddedSubjectError("Your year cannot add subjects.", "not_eligible")
    User.objects.select_for_update().filter(pk=user.pk).first()
    if _pending_request(user) is not None:
        raise AddedSubjectError("You already have a pending request.", "subject_change_pending")
    remove = added_subjects(user).filter(material_slug=remove_slug).first()
    if remove is None:
        raise AddedSubjectError("Choose a subject you added.", "subject_not_added")
    add = addable_subjects(user).filter(material_slug=add_slug).first()
    if add is None or added_subjects(user).filter(id=add.id).exists():
        raise AddedSubjectError("This subject cannot be added.", "subject_not_addable")
    return AddedSubjectChangeRequest.objects.create(
        user=user, remove_subject=remove, add_subject=add, note=note.strip()[:500]
    )


@transaction.atomic
def decide_change(
    *, request_id: UUID | str, approve: bool, actor: User, admin_note: str = ""
) -> AddedSubjectChangeRequest:
    item = (
        AddedSubjectChangeRequest.objects.select_for_update()
        .select_related("user", "remove_subject", "add_subject")
        .filter(id=request_id)
        .first()
    )
    if item is None:
        raise AddedSubjectError("Request not found.", "not_found")
    if item.status != AddedSubjectChangeRequest.Status.PENDING:
        raise AddedSubjectError("This request was already decided.", "already_decided")
    if approve:
        student = item.user
        # The student may have changed year since asking; never apply a swap
        # the rules would not allow today.
        if not addable_subjects(student).filter(id=item.add_subject_id).exists():
            raise AddedSubjectError(
                "The student can no longer add this subject.", "subject_not_addable"
            )
        AddedCatalogSubject.objects.filter(user=student, subject=item.remove_subject).delete()
        AddedCatalogSubject.objects.get_or_create(user=student, subject=item.add_subject)
    item.status = (
        AddedSubjectChangeRequest.Status.APPROVED
        if approve
        else AddedSubjectChangeRequest.Status.DECLINED
    )
    item.admin_note = admin_note.strip()[:500]
    item.decided_by = actor
    item.decided_at = timezone.now()
    item.save(update_fields=("status", "admin_note", "decided_by", "decided_at"))
    return item

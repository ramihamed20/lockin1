import logging
from collections import Counter
from re import findall
from typing import Any
from uuid import UUID

from django.conf import settings
from django.contrib.postgres.search import SearchQuery, SearchRank, SearchVector
from django.core.files.uploadedfile import UploadedFile
from django.db import connection
from django.db.models import Case, IntegerField, OuterRef, Q, QuerySet, Subquery, Value, When
from django.db.models.expressions import Combinable
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.services import record_audit
from apps.education.models import EducationNode
from apps.files.models import ManagedFile
from apps.files.services import FileValidationError, store_validated_upload, validate_upload

from .models import SubjectReference, SubjectReferencePage
from .pdf_extraction import MAX_BYTES, MAX_REFERENCE_PAGES, ExtractedPage


class ReferenceConflict(ValueError):
    pass


def current_references(*, subject_id: UUID) -> QuerySet[SubjectReference]:
    latest = SubjectReference.objects.filter(family_id=OuterRef("family_id")).order_by("-revision")
    return SubjectReference.objects.filter(
        subject_id=subject_id, revision=Subquery(latest.values("revision")[:1])
    )


def search_pages(
    references: QuerySet[SubjectReference], query: str
) -> QuerySet[SubjectReferencePage]:
    pages = SubjectReferencePage.objects.filter(
        reference__in=references.filter(indexed_at__isnull=False).order_by()
    ).select_related("reference")
    if connection.vendor == "postgresql":
        vector = SearchVector("text", config="simple")
        search = SearchQuery(query, config="simple", search_type="plain")
        return (
            pages.annotate(search_vector=vector, rank=SearchRank(vector, search))
            .filter(search_vector=search)
            .order_by("-rank", "reference_id", "page")
        )
    return pages.filter(text__icontains=query).order_by("reference_id", "page")


def filter_references(
    references: QuerySet[SubjectReference], query: str
) -> QuerySet[SubjectReference]:
    ids = search_pages(references, query).order_by().values("reference_id")
    return references.filter(Q(title__icontains=query) | Q(pk__in=ids))


def store_reference(
    *,
    actor: User,
    subject: EducationNode,
    upload: UploadedFile,
    title: str,
    kind: str,
    tags: list[str],
    previous_id: UUID | None,
    expected_revision: int | None,
) -> tuple[SubjectReference, ManagedFile]:
    validated = validate_upload(upload=upload, kind=ManagedFile.Kind.PDF)
    if (
        validated.size_bytes > MAX_BYTES
        or not 1 <= (validated.pdf_page_count or 0) <= MAX_REFERENCE_PAGES
    ):
        raise FileValidationError("A reference must be a readable PDF up to 50 MB and 500 pages.")
    EducationNode.objects.select_for_update().get(id=subject.id)
    if SubjectReference.objects.filter(
        subject=subject, checksum=validated.checksum_sha256
    ).exists():
        raise ReferenceConflict("This PDF is already recorded in this subject.")
    revision = 1
    values: dict[str, Any] = {}
    if previous_id is not None:
        previous = current_references(subject_id=subject.id).filter(id=previous_id).first()
        if previous is None or previous.revision != expected_revision:
            raise ReferenceConflict("The reference changed. Open its current revision.")
        revision = previous.revision + 1
        values["family_id"] = previous.family_id
    managed = store_validated_upload(owner=actor, upload=upload, validated=validated)
    try:
        reference = SubjectReference.objects.create(
            subject=subject,
            file=managed,
            title=title,
            kind=kind,
            tags=tags,
            checksum=validated.checksum_sha256,
            revision=revision,
            **values,
        )
        record_audit(
            actor=actor,
            action="automation.reference_uploaded",
            domain="automation",
            target_type="administration.subject_reference",
            target_id=str(reference.id),
            reason="Subject reference uploaded.",
            source="administration.automation",
            new_state={"subject_id": str(subject.id), "revision": revision, "kind": kind},
        )
    except Exception:
        delete_reference_upload(managed)
        raise
    return reference, managed


def delete_reference_upload(managed: ManagedFile) -> None:
    try:
        managed.blob.delete(save=False)
    except Exception:
        logging.getLogger(__name__).error("Could not clean up reference upload %s.", managed.id)


def commit_reference_pages(reference_id: UUID, pages: list[ExtractedPage]) -> None:
    reference = SubjectReference.objects.select_for_update().get(pk=reference_id)
    reference.pages.all().delete()
    SubjectReferencePage.objects.bulk_create(
        (SubjectReferencePage(reference=reference, **page) for page in pages), batch_size=100
    )
    reference.indexed_at = timezone.now()
    reference.save(update_fields=("indexed_at",))


def relevant_reference_sections(
    *, subject_id: UUID, lecture: list[ExtractedPage], title: str
) -> list[dict[str, Any]]:
    """Select small, subject-local excerpts with a positive topic match."""
    stopwords = {
        "about",
        "after",
        "before",
        "could",
        "lecture",
        "medical",
        "should",
        "slide",
        "study",
        "their",
        "there",
        "these",
        "those",
        "through",
        "which",
        "would",
    }

    def terms(text: str) -> list[str]:
        return [word for word in findall(r"[^\W\d_]{4,}", text.casefold()) if word not in stopwords]

    term_counts = Counter(terms(" ".join(page["text"][:1000] for page in lecture)))
    term_counts.update(terms(title) * 4)
    keys = [word for word, _ in term_counts.most_common(8)]
    if not keys:
        return []
    references = (
        current_references(subject_id=subject_id)
        .filter(indexed_at__isnull=False)
        .exclude(
            file__scan_status__in=(
                ManagedFile.ScanStatus.QUARANTINED,
                ManagedFile.ScanStatus.FAILED,
            )
        )
        .filter(file__validation_status=ManagedFile.ValidationStatus.READY)
    )
    if settings.CONTENT_REQUIRE_CLEAN_SCAN:
        references = references.filter(file__scan_status=ManagedFile.ScanStatus.CLEAN)
    score: Combinable = Value(0, output_field=IntegerField())
    for word in keys:
        score += Case(
            When(
                Q(text__icontains=word)
                | Q(reference__tags__icontains=word)
                | Q(reference__title__icontains=word),
                then=Value(1),
            ),
            default=Value(0),
        )
    rows = (
        SubjectReferencePage.objects.filter(reference__in=references.order_by())
        .annotate(
            score=score,
            exam_style=Case(
                When(
                    reference__kind__in=[
                        SubjectReference.Kind.PAST_EXAM,
                        SubjectReference.Kind.PROFESSOR_SAMPLE,
                    ],
                    then=Value(1),
                ),
                default=Value(0),
            ),
        )
        .filter(score__gte=1, needs_visual_review=False)
        .select_related("reference")
        .order_by("-score", "-exam_style", "reference_id", "page")[:12]
    )
    return [
        {
            "reference_id": str(row.reference_id),
            "revision": row.reference.revision,
            "title": row.reference.title,
            "kind": row.reference.kind,
            "page": row.page,
            "text": row.text[:900],
        }
        for row in rows
    ]

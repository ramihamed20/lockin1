"""Keep the Catalog branches in step with the education hierarchy.

``CatalogSubject`` is a projection of the education tree, not a second source of
truth: a subject a student can see is a subject their cohort's content root
owns. It exists as its own table because the public Materials route key has to
be stable and cohort-qualified, which a shared ``EducationNode.slug`` is not.

Until this module existed the projection was written exactly once, by migration
``content.0006``. Anything added to the hierarchy afterwards -- a new subject, a
new year, a cohort whose content root was attached later -- had no row, and a
subject with no row is invisible to students no matter how much content it
holds. This is the missing half: the same rule, expressed once, runnable at any
time, and triggered by the two events that can change the answer.

The projection deliberately only creates and refreshes. It never deactivates a
branch and never re-homes one to another cohort: a subject disappearing from a
student's Materials page is the failure this module exists to prevent, so it is
not something a background sync is allowed to cause. Retiring a branch stays an
explicit operator action.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from uuid import UUID

from django.db import IntegrityError, transaction

from apps.education.models import EducationNode, StudentCohort

from .models import CatalogSubject

logger = logging.getLogger("lockin.catalog")

# Display names the curriculum uses that do not survive slugification of the
# hierarchy title. Keyed by node slug, exactly as migration 0006 did.
TITLE_OVERRIDES = {
    "general-pathology": "General Pathology",
    "oral-histology": "Oral Histology",
    "fixed-prosthodontic": "Fixed Prosthodontic",
    "removable-prosthodontic": "Removable Prosthodontic",
}

_MATERIAL_SLUG_LIMIT = 240


@dataclass(slots=True)
class ProjectionResult:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    # Subject nodes under no cohort content root. Not an error: material can be
    # authored outside a student-visible branch. Reported so an operator can see
    # the difference between "not configured" and "broken".
    unowned: list[str] = field(default_factory=list)
    # A node another cohort already owns. The one-to-one link makes this a real
    # configuration conflict rather than something to silently resolve.
    conflicted: list[str] = field(default_factory=list)

    def merge(self, other: ProjectionResult) -> ProjectionResult:
        self.created.extend(other.created)
        self.updated.extend(other.updated)
        self.unowned.extend(other.unowned)
        self.conflicted.extend(other.conflicted)
        return self

    @property
    def changed(self) -> int:
        return len(self.created) + len(self.updated)


def material_slug_for(*, cohort: StudentCohort, node_slug: str) -> str:
    """The public Materials route key, qualified so two colleges never collide."""

    return f"{cohort.program.code}-{cohort.code}-{node_slug}"[:_MATERIAL_SLUG_LIMIT]


def _ancestor_ids(node: EducationNode) -> list[UUID]:
    """Every id on the node's own path, including itself.

    ``EducationNode.path`` is maintained as ``/<id>/<id>/.../`` by the education
    services, so ownership can be answered without walking parents one query at
    a time.
    """

    ids: list[UUID] = []
    for part in str(node.path or "").strip("/").split("/"):
        if not part:
            continue
        try:
            ids.append(UUID(part))
        except ValueError:
            continue
    if node.id not in ids:
        ids.append(node.id)
    return ids


def owning_cohort(node: EducationNode) -> StudentCohort | None:
    """The one cohort whose content root contains this subject.

    Ordering is deterministic rather than arbitrary so that a hierarchy shared
    by two cohorts -- a misconfiguration, since ``source_node`` is one-to-one --
    always resolves the same way instead of flapping between runs.
    """

    return (
        StudentCohort.objects.filter(is_active=True, content_nodes__id__in=_ancestor_ids(node))
        .select_related("program")
        .order_by("program__position", "position", "id")
        .first()
    )


@transaction.atomic
def project_subject_node(
    node: EducationNode, *, cohort: StudentCohort | None = None
) -> tuple[CatalogSubject | None, ProjectionResult]:
    """Ensure one subject node has its Catalog branch. Idempotent."""

    result = ProjectionResult()
    if node.kind != EducationNode.Kind.SUBJECT:
        return None, result

    cohort = cohort or owning_cohort(node)
    if cohort is None:
        result.unowned.append(node.slug)
        return None, result

    existing = CatalogSubject.objects.select_for_update().filter(source_node_id=node.id).first()
    if existing is not None:
        if existing.cohort_id != cohort.id:
            # Never re-home a branch: students' routes and their saved workspace
            # state hang off material_slug.
            result.conflicted.append(node.slug)
            return existing, result
        return existing, _refresh(existing, node, result)

    # A branch may already exist for this cohort and slug without a link -- the
    # seed migration allowed a null source_node. Adopt it rather than creating a
    # duplicate that the (cohort, slug) constraint would reject anyway.
    adopted = (
        CatalogSubject.objects.select_for_update()
        .filter(cohort_id=cohort.id, slug=node.slug, source_node__isnull=True)
        .first()
    )
    if adopted is not None:
        adopted.source_node = node
        adopted.save(update_fields=("source_node", "updated_at"))
        result.updated.append(adopted.material_slug)
        _refresh(adopted, node, ProjectionResult())
        return adopted, result

    subject = CatalogSubject(
        cohort=cohort,
        source_node=node,
        title=TITLE_OVERRIDES.get(node.slug, node.title),
        slug=node.slug,
        material_slug=material_slug_for(cohort=cohort, node_slug=node.slug),
        position=node.position,
        is_active=True,
    )
    try:
        subject.save()
    except IntegrityError:
        # Another request projected the same node between the lookup and the
        # insert, or the material slug collides with an unrelated branch. Both
        # are answered by reading what is actually there.
        logger.warning(
            "Catalog branch could not be projected",
            extra={"node_slug": node.slug, "cohort": cohort.code},
        )
        result.conflicted.append(node.slug)
        return CatalogSubject.objects.filter(source_node_id=node.id).first(), result
    result.created.append(subject.material_slug)
    return subject, result


def _refresh(
    subject: CatalogSubject, node: EducationNode, result: ProjectionResult
) -> ProjectionResult:
    """Carry a renamed or reordered subject through, and nothing else.

    ``is_active`` is untouched on purpose: an operator who retired a branch did
    so deliberately, and a sync must not undo it.
    """

    title = TITLE_OVERRIDES.get(node.slug, node.title)
    changes: list[str] = []
    if subject.title != title:
        subject.title = title
        changes.append("title")
    if subject.position != node.position:
        subject.position = node.position
        changes.append("position")
    if changes:
        subject.save(update_fields=(*changes, "updated_at"))
        result.updated.append(subject.material_slug)
    return result


def project_cohort(cohort: StudentCohort) -> ProjectionResult:
    """Project every subject beneath every content root this cohort owns."""

    result = ProjectionResult()
    roots = list(cohort.content_nodes.all())
    if not roots:
        return result
    seen: set[UUID] = set()
    for root in roots:
        subjects = EducationNode.objects.filter(
            kind=EducationNode.Kind.SUBJECT, path__startswith=root.path
        ).order_by("position", "title", "id")
        for node in subjects:
            if node.id in seen:
                continue
            seen.add(node.id)
            _, node_result = project_subject_node(node, cohort=cohort)
            result.merge(node_result)
    return result


def project_all() -> ProjectionResult:
    """Bring every active cohort's Catalog branches up to date."""

    result = ProjectionResult()
    cohorts = (
        StudentCohort.objects.filter(is_active=True)
        .select_related("program")
        .prefetch_related("content_nodes")
        .order_by("program__position", "position", "id")
    )
    for cohort in cohorts:
        result.merge(project_cohort(cohort))
    return result


def cohorts_without_branches() -> list[StudentCohort]:
    """Active cohorts a student could be enrolled in that expose no subjects.

    This is the shape of the outage this module was written for: an enrolment
    that resolves to an empty Materials page because its content root was never
    attached. It is a configuration gap, so it is reported rather than guessed
    at -- inventing a curriculum for a cohort would be worse than saying so.
    """

    return [
        cohort
        for cohort in StudentCohort.objects.filter(is_active=True)
        .select_related("program")
        .order_by("program__position", "position", "id")
        if not CatalogSubject.objects.filter(cohort=cohort, is_active=True).exists()
    ]

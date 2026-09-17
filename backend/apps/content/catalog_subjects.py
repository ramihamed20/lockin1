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


@dataclass(frozen=True, slots=True)
class StudyPath:
    """The College -> Specialty -> Year a branch sits under.

    Each level is read from the record that owns it: the college and specialty
    from the cohort's program name, and the Year from the ``academic_year`` node
    the subject actually hangs off in the education tree.

    The previous derivation guessed all three from display names -- it read the
    tail of the cohort's own name as the Year and hard-coded specialty
    "Dentistry" for every program that was not Human Medicine. A program named
    "Preparatory Medical Sciences -- Tripoli" was therefore filed under
    specialty "Dentistry" and Year "Tripoli", which is what made the Year filter
    in Admin -> Questions unusable for it.

    Each label carries a key, and the filters match on the key. Two colleges
    legitimately both have a "First Year", so the key keeps them one choice in
    the Year list while each still resolves to its own cohort's subjects --
    which is what keeps one year's questions out of another's.
    """

    college_title: str
    college_key: str
    specialty_title: str
    specialty_key: str
    academic_year_title: str
    academic_year_key: str


def _slugify_key(value: str) -> str:
    return "-".join("".join(c if c.isalnum() else " " for c in value.lower()).split()) or "unknown"


def _cohort_year_title(cohort: StudentCohort) -> str:
    """The Year a cohort names when its tree has no academic year above it.

    The cohort code is the structured fallback: ``year-1`` is a year, a bare
    number is an intake batch, and anything else names itself. It is never the
    cohort's display name, whose tail is what the old derivation misread.
    """

    code = str(cohort.code).strip()
    if code.lower().startswith("year-") and code[5:].isdigit():
        return f"Year {int(code[5:])}"
    if code.isdigit():
        return f"Batch {code}"
    return code.replace("-", " ").title() or str(cohort.name_en)


def study_paths_for(subjects: list[CatalogSubject]) -> dict[UUID, StudyPath]:
    """Resolve the study path of many branches, in one extra query.

    The Year is the title of the nearest ``academic_year`` ancestor, so it is
    the curriculum's own name for that year rather than anything reconstructed.
    Ancestors for every branch are fetched together: this runs on a list that,
    for a founder, is every branch in the deployment.
    """

    ancestors: dict[UUID, list[UUID]] = {}
    wanted: set[UUID] = set()
    for subject in subjects:
        source_node = subject.source_node
        ids = _ancestor_ids(source_node) if source_node is not None else []
        ancestors[subject.id] = ids
        wanted.update(ids)

    year_titles: dict[UUID, str] = {}
    if wanted:
        year_titles = dict(
            EducationNode.objects.filter(
                id__in=wanted, kind=EducationNode.Kind.ACADEMIC_YEAR
            ).values_list("id", "title")
        )

    paths: dict[UUID, StudyPath] = {}
    for subject in subjects:
        program = subject.cohort.program
        # Programs are named "<specialty> - <college>" wherever one specialty
        # runs on several campuses. A single-campus program carries only its
        # specialty, and its college is the deployment's home campus.
        specialty, _, college = str(program.name_en).partition(" — ")
        specialty = specialty.strip()
        college = college.strip() or "Tripoli"

        year = next(
            (
                year_titles[node_id]
                for node_id in reversed(ancestors[subject.id])
                if node_id in year_titles
            ),
            "",
        ) or _cohort_year_title(subject.cohort)

        paths[subject.id] = StudyPath(
            college_title=college,
            college_key=_slugify_key(college),
            specialty_title=specialty,
            specialty_key=_slugify_key(specialty),
            academic_year_title=year,
            academic_year_key=_slugify_key(year),
        )
    return paths


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

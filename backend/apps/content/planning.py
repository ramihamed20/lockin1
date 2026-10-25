"""Published content projection for planning; subject membership stays in Content."""

from uuid import UUID

from django.conf import settings
from django.db.models import Q

from apps.accounts.models import User
from apps.education.policies import is_content_administrator

from .models import CatalogSubject, CatalogWorkspaceSnapshot, LearningObject
from .selectors import published_learning_objects


def planning_catalog_positions(
    *, user: User, version_ids: list[UUID]
) -> dict[UUID, list[dict[str, object]]]:
    """A legacy catalog alias can change version; its saved page is unverified.

    Read only the page scalar, never notes, annotations or the full workspace.
    These positions cannot certify coverage of the current PDF.
    """
    grouped: dict[UUID, list[dict[str, object]]] = {}
    rows = CatalogWorkspaceSnapshot.objects.filter(
        user=user,
        document__version_id__in=version_ids,
        document__is_active=True,
    ).values("document__version_id", "document__managed_file_id", "state__view__page", "updated_at")
    for row in rows:
        page = row["state__view__page"]
        if type(page) is not int or page < 1:
            continue
        grouped.setdefault(row["document__version_id"], []).append(
            {
                "file_id": str(row["document__managed_file_id"]),
                "page": page,
                "updated_at": row["updated_at"],
                "version_verified": False,
                "source": "catalog_workspace",
            }
        )
    return grouped


def published_planning_sheets(
    *, user: User, subjects: list[CatalogSubject]
) -> dict[UUID, list[LearningObject]]:
    grouped: dict[UUID, list[LearningObject]] = {subject.id: [] for subject in subjects}
    paths = {
        subject.id: subject.source_node.path
        for subject in subjects
        if subject.source_node is not None
    }
    if not paths:
        return grouped
    condition = Q(pk__in=[])
    for path in paths.values():
        condition |= Q(published_version__academic_node__path__startswith=path)
    queryset = published_learning_objects(content_type="pdf").filter(condition)
    if getattr(settings, "COHORT_CONTENT_ENFORCEMENT", False) and not is_content_administrator(
        user
    ):
        # This adapter accepts the student's own exam subjects only. Earlier-year
        # additions are outside that exam cohort and cannot expand its syllabus.
        allowed = Q(pk__in=[])
        cohort = user.cohort
        if cohort is not None and cohort.is_active:
            for path in cohort.content_nodes.values_list("path", flat=True):
                allowed |= Q(published_version__academic_node__path__startswith=path)
        queryset = queryset.filter(allowed)
    for sheet in queryset:
        version = sheet.published_version
        if version is None:
            continue
        for subject_id, path in paths.items():
            if version.academic_node.path.startswith(path):
                grouped[subject_id].append(sheet)
    return grouped

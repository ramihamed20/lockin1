from uuid import UUID

from django.conf import settings
from django.db.models import Q, QuerySet

from apps.accounts.models import User

from .models import CreatorScope, EducationNode
from .policies import ancestor_paths, is_content_administrator


def public_nodes(*, parent_id: UUID | None) -> QuerySet[EducationNode]:
    return EducationNode.objects.filter(
        parent_id=parent_id,
        is_discoverable=True,
    ).order_by("position", "title", "id")


def cohort_visible_nodes(*, user: User, parent_id: UUID | None) -> QuerySet[EducationNode]:
    """Published tree navigation with the same cohort boundary as content."""
    nodes = public_nodes(parent_id=parent_id)
    if is_content_administrator(user) or not getattr(settings, "COHORT_CONTENT_ENFORCEMENT", False):
        return nodes
    cohort = user.cohort
    if cohort is None or not cohort.is_active:
        return nodes.none()
    condition = Q()
    for root_path in cohort.content_nodes.values_list("path", flat=True):
        # Include the selected branch and the breadcrumb ancestors necessary to
        # navigate to it, but never a sibling college/year.
        condition |= Q(path__startswith=root_path) | Q(path__in=ancestor_paths(root_path))
    return nodes.filter(condition)


def public_node(*, node_id: UUID) -> EducationNode:
    return EducationNode.objects.select_related("parent").get(
        id=node_id,
        is_discoverable=True,
    )


def cohort_visible_node(*, user: User, node_id: UUID) -> EducationNode:
    node = public_node(node_id=node_id)
    if is_content_administrator(user) or not getattr(settings, "COHORT_CONTENT_ENFORCEMENT", False):
        return node
    cohort = user.cohort
    if cohort is None or not cohort.is_active:
        raise EducationNode.DoesNotExist
    for root_path in cohort.content_nodes.values_list("path", flat=True):
        if node.path.startswith(root_path) or node.path in ancestor_paths(root_path):
            return node
    raise EducationNode.DoesNotExist


def node_breadcrumbs(node: EducationNode) -> list[EducationNode]:
    return list(
        EducationNode.objects.filter(path__in=ancestor_paths(node.path), is_discoverable=True)
        .only("id", "title", "kind", "path", "depth")
        .order_by("depth")
    )


def manageable_nodes(*, user: User) -> QuerySet[EducationNode]:
    queryset = EducationNode.objects.select_related("parent").order_by("path")
    if is_content_administrator(user):
        return queryset
    scope_paths = list(
        CreatorScope.objects.filter(user=user).values_list("node__path", flat=True).distinct()
    )
    if not scope_paths:
        return queryset.none()
    from django.db.models import Q

    condition = Q()
    for path in scope_paths:
        condition |= Q(path__startswith=path)
    return queryset.filter(condition)

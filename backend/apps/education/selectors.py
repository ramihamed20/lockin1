from uuid import UUID

from django.db.models import QuerySet

from apps.accounts.models import User

from .models import CreatorScope, EducationNode
from .policies import ancestor_paths, is_content_administrator


def public_nodes(*, parent_id: UUID | None) -> QuerySet[EducationNode]:
    return EducationNode.objects.filter(
        parent_id=parent_id,
        is_discoverable=True,
    ).order_by("position", "title", "id")


def public_node(*, node_id: UUID) -> EducationNode:
    return EducationNode.objects.select_related("parent").get(
        id=node_id,
        is_discoverable=True,
    )


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

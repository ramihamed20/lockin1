from uuid import UUID

from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.accounts.models import User
from apps.education.models import CreatorScope
from apps.education.policies import is_content_administrator

from .models import LearningObject


def published_learning_objects(
    *, node_id: UUID | None = None, content_type: str | None = None
) -> QuerySet[LearningObject]:
    now = timezone.now()
    queryset = LearningObject.objects.filter(
        published_version__isnull=False,
        archived_at__isnull=True,
        published_version__academic_node__is_discoverable=True,
    ).filter(
        Q(published_version__available_from__isnull=True)
        | Q(published_version__available_from__lte=now),
        Q(published_version__available_until__isnull=True)
        | Q(published_version__available_until__gt=now),
    )
    if node_id is not None:
        queryset = queryset.filter(published_version__academic_node_id=node_id)
    if content_type:
        queryset = queryset.filter(published_version__content_type=content_type)
    return (
        queryset.select_related(
            "owner",
            "published_version__academic_node",
        )
        .prefetch_related("published_version__assets__managed_file")
        .order_by("-published_at", "published_version__title", "id")
    )


def published_learning_object(*, learning_object_id: UUID) -> LearningObject:
    return published_learning_objects().get(id=learning_object_id)


def manageable_learning_objects(*, user: User) -> QuerySet[LearningObject]:
    queryset = LearningObject.objects.select_related(
        "owner",
        "current_version__academic_node",
        "published_version__academic_node",
    ).prefetch_related("current_version__assets__managed_file")
    if is_content_administrator(user):
        return queryset.order_by("-updated_at", "id")
    scope_paths = list(
        CreatorScope.objects.filter(user=user).values_list("node__path", flat=True).distinct()
    )
    condition = Q(owner=user)
    for path in scope_paths:
        condition |= Q(current_version__academic_node__path__startswith=path)
    return queryset.filter(condition).distinct().order_by("-updated_at", "id")

from uuid import UUID

from django.db.models import Q, QuerySet

from apps.accounts.models import User
from apps.education.models import CreatorScope
from apps.education.policies import is_administrator

from .models import Question


def published_questions(
    *,
    academic_path: str | None = None,
    difficulties: tuple[str, ...] = (),
) -> QuerySet[Question]:
    queryset = Question.objects.filter(
        published_version__isnull=False,
        retired_at__isnull=True,
        published_version__academic_node__is_discoverable=True,
    )
    if academic_path:
        queryset = queryset.filter(published_version__academic_node__path__startswith=academic_path)
    if difficulties:
        queryset = queryset.filter(published_version__difficulty__in=difficulties)
    return queryset.select_related(
        "published_version__academic_node",
    ).prefetch_related("published_version__options")


def published_question(*, question_id: UUID) -> Question:
    return published_questions().get(id=question_id)


def manageable_questions(*, user: User) -> QuerySet[Question]:
    queryset = Question.objects.select_related(
        "owner",
        "current_version__academic_node",
        "published_version__academic_node",
    ).prefetch_related("current_version__options")
    if is_administrator(user):
        return queryset.order_by("-updated_at", "id")
    scope_paths = list(
        CreatorScope.objects.filter(
            user=user,
            can_create_assessments=True,
        ).values_list("node__path", flat=True)
    )
    condition = Q(owner=user)
    for path in scope_paths:
        condition |= Q(current_version__academic_node__path__startswith=path)
    return queryset.filter(condition).distinct().order_by("-updated_at", "id")

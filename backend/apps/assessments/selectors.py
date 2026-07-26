from uuid import UUID

from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.accounts.models import User
from apps.education.models import CreatorScope
from apps.education.policies import is_assessment_administrator

from .models import Attempt, Quiz


def published_quizzes(*, node_id: UUID | None = None, mode: str | None = None) -> QuerySet[Quiz]:
    now = timezone.now()
    queryset = Quiz.objects.filter(
        published_version__isnull=False,
        retired_at__isnull=True,
        published_version__academic_node__is_discoverable=True,
    ).filter(
        Q(published_version__available_until__isnull=True)
        | Q(published_version__available_until__gt=now)
    )
    if node_id is not None:
        queryset = queryset.filter(published_version__academic_node_id=node_id)
    if mode:
        queryset = queryset.filter(published_version__mode=mode)
    return queryset.select_related(
        "published_version__academic_node",
    ).order_by("published_version__available_from", "published_version__title", "id")


def published_quiz(*, quiz_id: UUID) -> Quiz:
    return published_quizzes().get(id=quiz_id)


def manageable_quizzes(*, user: User) -> QuerySet[Quiz]:
    queryset = Quiz.objects.select_related(
        "owner",
        "current_version__academic_node",
        "published_version__academic_node",
    ).prefetch_related("current_version__question_links__question_version")
    if is_assessment_administrator(user):
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


def attempt_for_user(*, user: User, attempt_id: UUID) -> Attempt:
    return (
        Attempt.objects.filter(user=user)
        .select_related("quiz_version__academic_node", "quiz")
        .prefetch_related("questions__answer")
        .get(id=attempt_id)
    )

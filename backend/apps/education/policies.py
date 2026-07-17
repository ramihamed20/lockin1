from django.db.models import QuerySet

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role

from .models import CreatorScope, EducationNode


def ancestor_paths(path: str) -> tuple[str, ...]:
    segments = [segment for segment in path.split("/") if segment]
    return tuple("/" + "/".join(segments[:index]) + "/" for index in range(1, len(segments) + 1))


def is_administrator(user: User) -> bool:
    return user_has_role(user, Role.ADMINISTRATOR)


def _scopes_for_node(*, user: User, node: EducationNode) -> QuerySet[CreatorScope]:
    return CreatorScope.objects.filter(user=user, node__path__in=ancestor_paths(node.path))


def can_manage_hierarchy(*, user: User, node: EducationNode | None) -> bool:
    if is_administrator(user):
        return True
    if node is None:
        return False
    return _scopes_for_node(user=user, node=node).filter(can_manage_hierarchy=True).exists()


def can_create_content(*, user: User, node: EducationNode) -> bool:
    if is_administrator(user):
        return True
    return _scopes_for_node(user=user, node=node).filter(can_create_content=True).exists()


def can_review_content(*, user: User, node: EducationNode) -> bool:
    if is_administrator(user):
        return True
    return _scopes_for_node(user=user, node=node).filter(can_review_content=True).exists()


def can_publish_content(*, user: User, node: EducationNode) -> bool:
    if is_administrator(user):
        return True
    return _scopes_for_node(user=user, node=node).filter(can_publish_content=True).exists()

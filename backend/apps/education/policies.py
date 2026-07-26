from django.db.models import QuerySet

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role
from apps.administration.catalog import Capability
from apps.administration.permissions import has_operational_capability

from .models import CreatorScope, EducationNode


def ancestor_paths(path: str) -> tuple[str, ...]:
    segments = [segment for segment in path.split("/") if segment]
    return tuple("/" + "/".join(segments[:index]) + "/" for index in range(1, len(segments) + 1))


def is_administrator(user: User) -> bool:
    """Existing product-administrator check, kept for non-operational policies."""
    return user_has_role(user, Role.ADMINISTRATOR)


def is_content_administrator(user: User) -> bool:
    return is_administrator(user) or has_operational_capability(user, Capability.CONTENT_MANAGE)


def is_assessment_administrator(user: User) -> bool:
    return is_administrator(user) or has_operational_capability(user, Capability.ASSESSMENTS_MANAGE)


def _scopes_for_node(*, user: User, node: EducationNode) -> QuerySet[CreatorScope]:
    return CreatorScope.objects.filter(user=user, node__path__in=ancestor_paths(node.path))


def can_manage_hierarchy(*, user: User, node: EducationNode | None) -> bool:
    if is_content_administrator(user):
        return True
    if node is None:
        return False
    return _scopes_for_node(user=user, node=node).filter(can_manage_hierarchy=True).exists()


def can_create_content(*, user: User, node: EducationNode) -> bool:
    if is_content_administrator(user):
        return True
    return _scopes_for_node(user=user, node=node).filter(can_create_content=True).exists()


def can_review_content(*, user: User, node: EducationNode) -> bool:
    if is_content_administrator(user):
        return True
    return _scopes_for_node(user=user, node=node).filter(can_review_content=True).exists()


def can_publish_content(*, user: User, node: EducationNode) -> bool:
    if is_content_administrator(user):
        return True
    return _scopes_for_node(user=user, node=node).filter(can_publish_content=True).exists()


def can_create_assessments(*, user: User, node: EducationNode) -> bool:
    if is_assessment_administrator(user):
        return True
    return _scopes_for_node(user=user, node=node).filter(can_create_assessments=True).exists()


def can_review_assessments(*, user: User, node: EducationNode) -> bool:
    if is_assessment_administrator(user):
        return True
    return _scopes_for_node(user=user, node=node).filter(can_review_assessments=True).exists()


def can_publish_assessments(*, user: User, node: EducationNode) -> bool:
    if is_assessment_administrator(user):
        return True
    return _scopes_for_node(user=user, node=node).filter(can_publish_assessments=True).exists()

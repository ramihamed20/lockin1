from uuid import UUID

from apps.accounts.models import User
from apps.accounts.roles import Role
from apps.administration.catalog import Capability
from apps.administration.permissions import has_operational_capability
from apps.community.models import CommunitySpace, SpaceMembership

from .models import Report


def is_moderator(user: User) -> bool:
    return Role.MODERATOR.value in _moderation_roles(user) or is_administrator(user)


def is_administrator(user: User) -> bool:
    return Role.ADMINISTRATOR.value in _moderation_roles(user)


def _moderation_roles(user: User) -> frozenset[str]:
    cached = user.__dict__.get("_moderation_role_cache")
    if isinstance(cached, frozenset):
        return cached
    roles = frozenset(user.groups.values_list("name", flat=True))
    if user.is_superuser:
        roles |= frozenset((Role.ADMINISTRATOR.value,))
    user.__dict__["_moderation_role_cache"] = roles
    return roles


def has_report_conflict(*, user: User, report: Report) -> bool:
    return report.reporter_id == user.id or report.target_author_id == user.id


def moderated_private_space_ids(*, user: User) -> list[UUID]:
    cached = user.__dict__.get("_moderated_private_space_cache")
    if isinstance(cached, list):
        return cached
    owned = CommunitySpace.objects.filter(owner=user).values_list("id", flat=True)
    memberships = SpaceMembership.objects.filter(
        user=user,
        role=SpaceMembership.Role.MODERATOR,
        status=SpaceMembership.Status.ACTIVE,
    ).values_list("space_id", flat=True)
    space_ids = [*owned, *memberships]
    user.__dict__["_moderated_private_space_cache"] = space_ids
    return space_ids


def can_access_moderation_tools(*, user: User) -> bool:
    return (
        is_moderator(user)
        or has_operational_capability(user, Capability.MODERATION_VIEW)
        or bool(moderated_private_space_ids(user=user))
    )


def can_manage_report(*, user: User, report: Report) -> bool:
    if is_administrator(user):
        return True
    if has_report_conflict(user=user, report=report):
        return False
    if has_operational_capability(user, Capability.MODERATION_MANAGE):
        return True
    if report.private_space_id is None:
        return is_moderator(user)
    return report.private_space_id in moderated_private_space_ids(user=user)


def can_view_report(*, user: User, report: Report) -> bool:
    return report.reporter_id == user.id or can_manage_report(user=user, report=report)

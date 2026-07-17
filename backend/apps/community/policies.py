from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role

from .models import CommunitySpace, Discussion, SpaceMembership


def is_global_moderator(user: User) -> bool:
    return user_has_role(user, Role.MODERATOR) or user_has_role(user, Role.ADMINISTRATOR)


def is_administrator(user: User) -> bool:
    return user_has_role(user, Role.ADMINISTRATOR)


def membership_for(*, user: User, space: CommunitySpace) -> SpaceMembership | None:
    memberships = getattr(space, "viewer_memberships", None)
    if memberships is not None:
        return memberships[0] if memberships else None
    return SpaceMembership.objects.filter(
        space=space,
        user=user,
        status=SpaceMembership.Status.ACTIVE,
    ).first()


def can_view_space(*, user: User, space: CommunitySpace) -> bool:
    if is_administrator(user) or space.owner_id == user.id:
        return True
    return membership_for(user=user, space=space) is not None


def can_manage_space(*, user: User, space: CommunitySpace) -> bool:
    return is_administrator(user) or space.owner_id == user.id


def can_moderate_space(*, user: User, space: CommunitySpace) -> bool:
    if can_manage_space(user=user, space=space):
        return True
    membership = membership_for(user=user, space=space)
    return membership is not None and membership.role == SpaceMembership.Role.MODERATOR


def can_view_discussion(*, user: User, discussion: Discussion) -> bool:
    if discussion.space_id is None:
        return True
    space = discussion.space
    return space is not None and can_view_space(user=user, space=space)


def can_create_in_space(*, user: User, space: CommunitySpace) -> bool:
    return space.status == CommunitySpace.Status.ACTIVE and can_view_space(user=user, space=space)


def can_edit_discussion(*, user: User, discussion: Discussion) -> bool:
    return discussion.author_id == user.id and discussion.status == Discussion.Status.ACTIVE


def can_remove_discussion(*, user: User, discussion: Discussion) -> bool:
    if discussion.author_id == user.id and discussion.status == Discussion.Status.ACTIVE:
        return True
    if discussion.space_id is None:
        return is_global_moderator(user)
    space = discussion.space
    return space is not None and can_moderate_space(user=user, space=space)

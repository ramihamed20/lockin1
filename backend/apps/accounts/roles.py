from enum import StrEnum

from django.contrib.auth.models import Group
from django.db import transaction

from platform_core.events import publish_after_commit

from .events import UserRolesChanged
from .models import AccountSecurityEvent, User


class Role(StrEnum):
    STUDENT = "student"
    MODERATOR = "moderator"
    CREATOR = "creator"
    ADMINISTRATOR = "administrator"


MANAGED_ROLES = frozenset({Role.MODERATOR, Role.CREATOR, Role.ADMINISTRATOR})


class RoleChangeError(ValueError):
    pass


def get_user_roles(user: User) -> tuple[str, ...]:
    roles: set[str] = {Role.STUDENT.value}
    roles.update(
        name
        for name in user.groups.values_list("name", flat=True)
        if name in {role.value for role in MANAGED_ROLES}
    )
    if user.is_superuser:
        roles.add(Role.ADMINISTRATOR.value)
    return tuple(role.value for role in Role if role.value in roles)


def user_has_role(user: User, role: Role) -> bool:
    if role is Role.STUDENT:
        return True
    if role is Role.ADMINISTRATOR and user.is_superuser:
        return True
    return user.groups.filter(name=role.value).exists()


@transaction.atomic
def replace_managed_roles(*, target: User, actor: User, roles: set[Role]) -> tuple[str, ...]:
    if not roles.issubset(MANAGED_ROLES):
        raise RoleChangeError("Only managed roles can be assigned.")
    if target.is_superuser and Role.ADMINISTRATOR not in roles:
        raise RoleChangeError("A superuser's administrator role cannot be removed here.")

    target = User.objects.select_for_update().get(id=target.id)
    removing_administrator = user_has_role(target, Role.ADMINISTRATOR) and (
        Role.ADMINISTRATOR not in roles
    )
    if removing_administrator:
        other_admin_exists = (
            User.objects.filter(
                status=User.Status.ACTIVE,
                groups__name=Role.ADMINISTRATOR.value,
            )
            .exclude(id=target.id)
            .exists()
            or User.objects.filter(
                status=User.Status.ACTIVE,
                is_superuser=True,
            )
            .exclude(id=target.id)
            .exists()
        )
        if not other_admin_exists:
            raise RoleChangeError("The final active administrator cannot be removed.")

    groups = {
        group.name: group for group in Group.objects.filter(name__in=[r.value for r in roles])
    }
    if len(groups) != len(roles):
        raise RoleChangeError("Role groups are not initialized.")

    existing_managed = list(target.groups.filter(name__in=[r.value for r in MANAGED_ROLES]))
    target.groups.remove(*existing_managed)
    target.groups.add(*(groups[role.value] for role in roles))
    assigned = get_user_roles(target)
    AccountSecurityEvent.objects.create(
        user=target,
        actor=actor,
        event_type=AccountSecurityEvent.EventType.ROLE_CHANGED,
        metadata={"roles": list(assigned)},
    )
    publish_after_commit(UserRolesChanged(user_id=target.id, roles=assigned, actor_id=actor.id))
    return assigned

from collections.abc import Iterable
from uuid import UUID

from django.db import transaction

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role
from apps.audit.services import record_audit

from .models import OperationalRole, OperationalRoleAssignment


class OperationalRoleError(ValueError):
    pass


@transaction.atomic
def replace_operational_roles(
    *, target: User, actor: User, role_codes: Iterable[str], reason: str, source: str
) -> tuple[str, ...]:
    normalized = frozenset(role_codes)
    roles = {role.code: role for role in OperationalRole.objects.filter(code__in=normalized)}
    if set(roles) != set(normalized):
        raise OperationalRoleError("One or more operational roles are unknown.")
    reason = reason.strip()
    if len(reason) < 8:
        raise OperationalRoleError("A reason of at least 8 characters is required.")

    lock_effective_platform_administrators()
    target = User.objects.select_for_update().get(id=target.id)
    previous = tuple(
        OperationalRoleAssignment.objects.filter(user=target)
        .order_by("role_id")
        .values_list("role_id", flat=True)
    )
    removing_platform_admin = "platform_administrator" in previous and (
        "platform_administrator" not in normalized
    )
    retains_product_admin = target.status == User.Status.ACTIVE and user_has_role(
        target, Role.ADMINISTRATOR
    )
    if (
        removing_platform_admin
        and not retains_product_admin
        and not other_effective_platform_administrator_exists(target=target)
    ):
        raise OperationalRoleError("The final active platform administrator cannot be removed.")

    OperationalRoleAssignment.objects.filter(user=target).exclude(role_id__in=normalized).delete()
    for role in roles.values():
        OperationalRoleAssignment.objects.update_or_create(
            user=target,
            role=role,
            defaults={"granted_by": actor, "reason": reason},
        )
    current = tuple(sorted(normalized))
    record_audit(
        actor=actor,
        action="administration.operational_roles.replaced",
        domain="administration",
        target_type="accounts.user",
        target_id=str(target.id),
        reason=reason,
        source=source,
        previous_state={"roles": previous},
        new_state={"roles": current},
        related_entities=[{"type": "accounts.user", "id": str(target.id)}],
    )
    return current


def other_effective_platform_administrator_exists(*, target: User) -> bool:
    explicit = OperationalRoleAssignment.objects.filter(
        role_id="platform_administrator", user__status=User.Status.ACTIVE
    ).exclude(user=target)
    if explicit.exists():
        return True
    return (
        User.objects.filter(status=User.Status.ACTIVE, groups__name=Role.ADMINISTRATOR.value)
        .exclude(id=target.id)
        .exists()
        or User.objects.filter(status=User.Status.ACTIVE, is_superuser=True)
        .exclude(id=target.id)
        .exists()
    )


def is_effective_platform_administrator(*, user: User) -> bool:
    if user.status != User.Status.ACTIVE:
        return False
    return (
        user_has_role(user, Role.ADMINISTRATOR)
        or OperationalRoleAssignment.objects.filter(
            user=user, role_id="platform_administrator"
        ).exists()
    )


def is_final_effective_platform_administrator(*, user: User) -> bool:
    return is_effective_platform_administrator(
        user=user
    ) and not other_effective_platform_administrator_exists(target=user)


def lock_effective_platform_administrators() -> tuple[UUID, ...]:
    """Lock effective platform administrators in a stable order for mutation checks."""
    explicit_ids = OperationalRoleAssignment.objects.filter(
        role_id="platform_administrator", user__status=User.Status.ACTIVE
    ).values_list("user_id", flat=True)
    product_ids = User.objects.filter(
        status=User.Status.ACTIVE, groups__name=Role.ADMINISTRATOR.value
    ).values_list("id", flat=True)
    superuser_ids = User.objects.filter(status=User.Status.ACTIVE, is_superuser=True).values_list(
        "id", flat=True
    )
    effective_ids = frozenset((*explicit_ids, *product_ids, *superuser_ids))
    return tuple(
        User.objects.select_for_update()
        .filter(id__in=effective_ids)
        .order_by("id")
        .values_list("id", flat=True)
    )

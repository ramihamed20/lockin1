from typing import cast

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role

from .models import OperationalCapabilityAssignment, OperationalRoleAssignment


def operational_capabilities(user: User) -> frozenset[str]:
    if not user.is_authenticated or user.status != User.Status.ACTIVE:
        return frozenset()
    cached = user.__dict__.get("_operational_capability_cache")
    if isinstance(cached, frozenset):
        return cached
    if user_has_role(user, Role.ADMINISTRATOR):
        from .catalog import CAPABILITIES

        capabilities = frozenset(item.code for item in CAPABILITIES)
    else:
        role_capabilities = OperationalRoleAssignment.objects.filter(user=user).values_list(
            "role__capabilities__code", flat=True
        )
        direct_capabilities = OperationalCapabilityAssignment.objects.filter(user=user).values_list(
            "capability_id", flat=True
        )
        capabilities = frozenset((*role_capabilities, *direct_capabilities))
    user.__dict__["_operational_capability_cache"] = capabilities
    return capabilities


def has_operational_capability(user: User, capability: str) -> bool:
    return capability in operational_capabilities(user)


class HasOperationalCapability(BasePermission):
    message = "The required operational permission is not assigned."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = request.user
        capability = cast(str, getattr(view, "required_capability", ""))
        return (
            isinstance(user, User)
            and user.is_authenticated
            and bool(capability)
            and has_operational_capability(user, capability)
        )

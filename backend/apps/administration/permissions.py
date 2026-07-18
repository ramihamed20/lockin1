from typing import cast

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role

from .models import OperationalRoleAssignment


def operational_capabilities(user: User) -> frozenset[str]:
    if not user.is_authenticated or user.status != User.Status.ACTIVE:
        return frozenset()
    if user_has_role(user, Role.ADMINISTRATOR):
        from .catalog import CAPABILITIES

        return frozenset(item.code for item in CAPABILITIES)
    return frozenset(
        OperationalRoleAssignment.objects.filter(user=user).values_list(
            "role__capabilities__code", flat=True
        )
    )


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

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role


class IsCreatorOrAdministrator(BasePermission):
    message = "Creator or administrator permission is required."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = request.user
        return (
            isinstance(user, User)
            and user.is_authenticated
            and (user_has_role(user, Role.CREATOR) or user_has_role(user, Role.ADMINISTRATOR))
        )

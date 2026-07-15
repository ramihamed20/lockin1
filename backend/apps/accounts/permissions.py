from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from .models import User
from .roles import Role, user_has_role


class IsAdministrator(BasePermission):
    message = "Administrator permission is required."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = request.user
        return (
            isinstance(user, User)
            and user.is_authenticated
            and user_has_role(user, Role.ADMINISTRATOR)
        )

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.accounts.models import User

from .policies import can_access_moderation_tools


class HasModerationWorkspace(BasePermission):
    message = "Moderation workspace permission is required."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = request.user
        return (
            isinstance(user, User)
            and user.is_authenticated
            and can_access_moderation_tools(user=user)
        )

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role
from apps.administration.catalog import Capability
from apps.administration.permissions import has_operational_capability


class IsCreatorOrAdministrator(BasePermission):
    message = "Creator, product administrator, or content administrator permission is required."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = request.user
        module = type(view).__module__
        required_capability = (
            Capability.ASSESSMENTS_MANAGE
            if module.startswith(("apps.questions.", "apps.assessments."))
            else Capability.CONTENT_MANAGE
        )
        return (
            isinstance(user, User)
            and user.is_authenticated
            and (
                user_has_role(user, Role.CREATOR)
                or user_has_role(user, Role.ADMINISTRATOR)
                or has_operational_capability(user, required_capability)
            )
        )

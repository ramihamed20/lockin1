from typing import ClassVar

from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.accounts.models import User

from .services import require_entitlement


class EntitlementRequiredMixin(APIView):
    required_entitlement: ClassVar[str]

    def check_permissions(self, request: Request) -> None:
        super().check_permissions(request)
        user = request.user
        if not isinstance(user, User):
            raise PermissionDenied("An authenticated account is required.")
        require_entitlement(user=user, entitlement_code=self.required_entitlement)

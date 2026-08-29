from unittest.mock import patch

import pytest
from rest_framework.exceptions import PermissionDenied
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user

from ..permissions import EntitlementRequiredMixin

pytestmark = pytest.mark.django_db


class ProtectedEntitlementView(EntitlementRequiredMixin):
    required_entitlement = "focus.workspace"
    permission_classes = ()


def _request_for(user: User | None = None) -> tuple[ProtectedEntitlementView, Request]:
    raw_request = APIRequestFactory().get("/protected")
    if user is not None:
        force_authenticate(raw_request, user=user)
    view = ProtectedEntitlementView()
    return view, view.initialize_request(raw_request)


def test_entitlement_mixin_requires_an_authenticated_account() -> None:
    view, request = _request_for()

    with pytest.raises(PermissionDenied, match="authenticated account"):
        view.check_permissions(request)


def test_entitlement_mixin_delegates_the_authoritative_check() -> None:
    user = create_user()
    view, request = _request_for(user)

    with patch("apps.entitlements.permissions.require_entitlement") as require:
        view.check_permissions(request)

    require.assert_called_once_with(user=user, entitlement_code="focus.workspace")

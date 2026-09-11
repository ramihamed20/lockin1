"""The subscription gate on managed-file delivery, decided per object.

``/api/v1/files/<id>/<disposition>`` serves two different things: premium study
material, and profile avatars. The app-wide ``SubscriptionProtectedPermission``
could only answer for both at once, so an expired subscription took the avatars
down with the study material -- including the avatar on the renewal screen.

Delivery is now exempt from the app-wide gate and applies it itself, against the
object it resolved. These tests hold both halves of that bargain.
"""

from typing import Any

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user, csrf_client
from apps.accounts.tests.test_avatars import avatar_upload
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, published_path
from apps.entitlements.models import EntitlementGrant
from apps.subscriptions.models import Subscription

from .helpers import close_streamed

pytestmark = pytest.mark.django_db


def expire_access(user: User) -> None:
    """Put the account past the end of its paid window, the way time does.

    The subscription row stays, which is what stops the gate from handing out a
    replacement trial; only the window has closed.
    """

    now = timezone.now()
    EntitlementGrant.objects.filter(user=user).update(
        status=EntitlementGrant.Status.EXPIRED, revoked_at=now
    )
    Subscription.objects.filter(account__primary_user=user).update(
        status=Subscription.Status.EXPIRED, ended_at=now
    )


def upload_avatar(user: User) -> str:
    client, csrf = csrf_client()
    client.force_login(user)
    response = client.post(
        "/api/v1/account/profile/avatar",
        {"file": avatar_upload()},
        format="multipart",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert response.status_code == 201
    url = response.json()["user"]["avatar"]["url"]
    assert isinstance(url, str) and url
    return url


def test_expired_subscription_still_delivers_an_allowed_avatar() -> None:
    owner = create_user(email="avatar-owner@example.com", with_trial=True)
    reader = create_user(email="expired-reader@example.com", with_trial=True)
    avatar_url = upload_avatar(owner)
    expire_access(reader)

    client = APIClient()
    client.force_authenticate(reader)
    viewed = client.get(avatar_url)

    assert viewed.status_code == 200
    assert viewed["Content-Type"] == "image/png"
    close_streamed(viewed)


def test_expired_subscription_still_delivers_the_readers_own_avatar() -> None:
    reader = create_user(email="self-avatar@example.com", with_trial=True)
    avatar_url = upload_avatar(reader)
    expire_access(reader)

    client = APIClient()
    client.force_authenticate(reader)
    viewed = client.get(avatar_url)

    assert viewed.status_code == 200
    close_streamed(viewed)


def test_expired_subscription_is_still_refused_the_premium_study_file() -> None:
    admin = create_admin()
    student = create_user(email="expired-student@example.com", with_trial=True)
    _, _, lesson = published_path(admin=admin)
    learning_object = published_pdf(actor=admin, node=lesson)
    assert learning_object.published_version is not None
    file_id = learning_object.published_version.assets.get(role="primary").managed_file_id

    entitled = APIClient()
    entitled.force_authenticate(student)
    allowed = entitled.get(f"/api/v1/files/{file_id}/view")
    assert allowed.status_code == 200
    close_streamed(allowed)

    expire_access(student)
    client = APIClient()
    client.force_authenticate(student)
    refused = client.get(f"/api/v1/files/{file_id}/view")

    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "permission_denied"


def test_anonymous_callers_reach_no_managed_file_at_all() -> None:
    owner = create_user(email="anon-probe-owner@example.com", with_trial=True)
    avatar_url = upload_avatar(owner)

    response = APIClient().get(avatar_url)

    assert response.status_code in {401, 403}


def test_avatar_exemption_does_not_cover_the_rest_of_the_files_app(settings: Any) -> None:
    """The exemption is one URL wide.

    Upload and scan-decision stay behind their own permission classes, and the
    app-wide gate still applies to every other route in the files app.
    """

    from apps.entitlements.access_permissions import (
        PER_OBJECT_ENTITLEMENT_VIEWS,
        PROTECTED_APP_ENTITLEMENTS,
    )

    assert frozenset({"files:delivery"}) == PER_OBJECT_ENTITLEMENT_VIEWS
    assert PROTECTED_APP_ENTITLEMENTS["files"] == "content.premium"

    student = create_user(email="no-upload@example.com", with_trial=True)
    expire_access(student)
    client = APIClient()
    client.force_authenticate(student)

    assert client.post("/api/v1/management/files", {}, format="multipart").status_code == 403

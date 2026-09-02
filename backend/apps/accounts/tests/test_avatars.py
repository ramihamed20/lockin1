import base64
from typing import Any

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.files.models import ManagedFile

from .helpers import PASSWORD, create_user, csrf_client

pytestmark = pytest.mark.django_db


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLidAAAAABJRU5ErkJggg=="
)


def avatar_upload(name: str = "avatar.png") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, PNG_1X1, content_type="image/png")


@pytest.mark.parametrize(
    "default_id",
    [
        "cat-male-grayblue",
        "cat-female-calico",
        "cat-male-orange",
        "cat-male-tuxedo",
        "cat-female-lavender",
        "cat-female-pink",
    ],
)
def test_each_supplied_default_avatar_can_be_selected(default_id: str) -> None:
    user = create_user()
    client, csrf = csrf_client()
    client.force_login(user)

    response = client.patch(
        "/api/v1/account/profile",
        {"avatar_default": default_id},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert response.status_code == 200
    assert response.json()["user"]["avatar"]["default_id"] == default_id


def test_default_avatar_choice_persists_and_replaces_a_custom_image() -> None:
    user = create_user()
    client, csrf = csrf_client()
    client.force_login(user)

    uploaded = client.post(
        "/api/v1/account/profile/avatar",
        {"file": avatar_upload()},
        format="multipart",
        HTTP_X_CSRFTOKEN=csrf,
    )
    selected = client.patch(
        "/api/v1/account/profile",
        {"avatar_default": "cat-female-calico"},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    refreshed = client.get("/api/v1/auth/session")
    logged_out = client.post("/api/v1/auth/logout", format="json", HTTP_X_CSRFTOKEN=csrf)
    login_csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    logged_in = client.post(
        "/api/v1/auth/login",
        {"email": user.email, "password": PASSWORD, "remember_me": True},
        format="json",
        HTTP_X_CSRFTOKEN=login_csrf,
    )

    assert uploaded.status_code == 201
    assert uploaded.json()["user"]["avatar"]["source"] == "custom"
    assert selected.status_code == 200
    assert selected.json()["user"]["avatar"] == {
        "source": "default",
        "default_id": "cat-female-calico",
        "url": None,
    }
    assert refreshed.json()["user"]["avatar"] == selected.json()["user"]["avatar"]
    assert logged_out.status_code == 204
    assert logged_in.status_code == 200
    assert logged_in.json()["user"]["avatar"] == selected.json()["user"]["avatar"]
    user.refresh_from_db()
    assert user.profile_image_id is None
    assert user.avatar_default == "cat-female-calico"


def test_profile_avatar_upload_validates_type_size_and_uses_managed_storage(settings: Any) -> None:
    user = create_user()
    client, csrf = csrf_client()
    client.force_login(user)

    invalid = client.post(
        "/api/v1/account/profile/avatar",
        {"file": SimpleUploadedFile("avatar.gif", b"GIF89a", content_type="image/gif")},
        format="multipart",
        HTTP_X_CSRFTOKEN=csrf,
    )
    settings.PROFILE_AVATAR_MAX_BYTES = len(PNG_1X1) - 1
    oversized = client.post(
        "/api/v1/account/profile/avatar",
        {"file": avatar_upload("too-large.png")},
        format="multipart",
        HTTP_X_CSRFTOKEN=csrf,
    )
    settings.PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024
    accepted = client.post(
        "/api/v1/account/profile/avatar",
        {"file": avatar_upload()},
        format="multipart",
        HTTP_X_CSRFTOKEN=csrf,
    )

    assert invalid.status_code == 400
    assert oversized.status_code == 400
    assert accepted.status_code == 201
    avatar = accepted.json()["user"]["avatar"]
    assert avatar["source"] == "custom"
    assert avatar["url"].endswith("/view")
    stored = ManagedFile.objects.get(owner=user, kind=ManagedFile.Kind.AVATAR)
    assert stored.content_type == "image/png"
    assert str(stored.id) in stored.blob.name


def test_avatar_delivery_is_available_to_authenticated_students_but_not_downloadable() -> None:
    owner = create_user(email="owner@example.com", with_trial=True)
    reader = create_user(email="reader@example.com", with_trial=True)
    owner_client, csrf = csrf_client()
    owner_client.force_login(owner)
    uploaded = owner_client.post(
        "/api/v1/account/profile/avatar",
        {"file": avatar_upload()},
        format="multipart",
        HTTP_X_CSRFTOKEN=csrf,
    )
    url = uploaded.json()["user"]["avatar"]["url"]

    reader_client, _ = csrf_client()
    reader_client.force_login(reader)
    viewed = reader_client.get(url)
    downloaded = reader_client.get(url.replace("/view", "/download"))

    assert viewed.status_code == 200
    assert viewed["Content-Type"] == "image/png"
    assert downloaded.status_code == 404

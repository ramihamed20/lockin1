"""Lo-Fi scenes: upload once, store once, loop on the client."""

from collections.abc import Callable
from datetime import timedelta
from typing import Any
from uuid import uuid4

import pytest
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.audit.models import AuditRecord
from apps.education.tests.helpers import create_admin
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.files.models import ManagedFile
from apps.files.services import create_managed_file
from apps.files.tests.video_fixtures import mp4, webm

pytestmark = pytest.mark.django_db

ADMIN_URL = "/api/v1/operations/admin/lofi-scenes"
STUDENT_URL = "/api/v1/focus/paper-workspace/scenes"
PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + bytes(32)


def _grant(user: User, code: str) -> None:
    EntitlementGrant.objects.create(
        user=user,
        entitlement=EntitlementDefinition.objects.get(code=code),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
    )


def _client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _student() -> User:
    student = create_user(email=f"{uuid4().hex[:10]}@example.com")
    _grant(student, "focus.workspace")
    _grant(student, "content.premium")
    return student


def _upload(admin: User, data: bytes, name: str, content_type: str) -> ManagedFile:
    return create_managed_file(
        owner=admin,
        upload=SimpleUploadedFile(name, data, content_type=content_type),
        kind=ManagedFile.Kind.WORKSPACE_MEDIA,
    )


def _clip(admin: User, seconds: float = 20) -> ManagedFile:
    return _upload(admin, mp4(seconds), "clip.mp4", "video/mp4")


def _create(client: APIClient, **fields: Any) -> dict[str, Any]:
    response = client.post(ADMIN_URL, {"enabled": True, **fields}, format="json")
    assert response.status_code == 201, response.content
    return response.json()  # type: ignore[no-any-return]


def _scene(payload: dict[str, Any], title: str) -> dict[str, Any]:
    return next(scene for scene in payload["scenes"] if scene["title"] == title)


def test_students_see_enabled_scenes_in_order_with_one_stored_clip_each() -> None:
    admin = create_admin()
    admin_client = _client(admin)
    student_client = _client(_student())
    assert student_client.get(STUDENT_URL).json() == {"scenes": []}

    rain = _clip(admin, 20)
    cover = _upload(admin, PNG, "rain.png", "image/png")
    _create(
        admin_client,
        title="  Rainy   night ",
        media_file_id=str(rain.id),
        cover_file_id=str(cover.id),
    )
    library = _upload(admin, webm(30), "library.webm", "video/webm")
    _create(admin_client, title="Library", media_file_id=str(library.id))
    cafe = _clip(admin, 15)
    _create(admin_client, title="Coffee shop", media_file_id=str(cafe.id), enabled=False)

    scenes = student_client.get(STUDENT_URL).json()["scenes"]
    assert [scene["title"] for scene in scenes] == ["Rainy night", "Library"]
    first = scenes[0]
    assert first["url"] == f"/api/v1/files/{rain.id}/view"
    assert first["cover_url"] == f"/api/v1/files/{cover.id}/view"
    assert first["media_type"] == "video"
    assert first["duration_ms"] == 20_000
    assert scenes[1]["content_type"] == "video/webm"
    # The original clip is the only media stored: nothing longer is generated.
    assert ManagedFile.objects.filter(kind=ManagedFile.Kind.WORKSPACE_MEDIA).count() == 4


def test_reordering_changes_what_students_see_first() -> None:
    admin = create_admin()
    client = _client(admin)
    for title in ("Cat at desk", "Rainy night", "Library"):
        payload = _create(client, title=title, media_file_id=str(_clip(admin).id))
    ids = {scene["title"]: scene["id"] for scene in payload["scenes"]}

    order = [ids["Library"], ids["Cat at desk"], ids["Rainy night"]]
    reordered = client.put(f"{ADMIN_URL}/order", {"scene_ids": order}, format="json")
    assert reordered.status_code == 200
    assert [scene["title"] for scene in reordered.json()["scenes"]] == [
        "Library",
        "Cat at desk",
        "Rainy night",
    ]
    assert [s["title"] for s in _client(_student()).get(STUDENT_URL).json()["scenes"]] == [
        "Library",
        "Cat at desk",
        "Rainy night",
    ]
    # An order that does not name every scene exactly once is stale.
    assert (
        client.put(f"{ADMIN_URL}/order", {"scene_ids": order[:2]}, format="json").status_code == 409
    )
    assert (
        client.put(
            f"{ADMIN_URL}/order", {"scene_ids": [*order, order[0]]}, format="json"
        ).status_code
        == 409
    )


def test_replacing_and_deleting_remove_the_old_file_from_storage(
    django_capture_on_commit_callbacks: Callable[..., Any],
) -> None:
    admin = create_admin()
    client = _client(admin)
    old_clip = _clip(admin)
    old_cover = _upload(admin, PNG, "c.png", "image/png")
    created = _create(
        client, title="Rain", media_file_id=str(old_clip.id), cover_file_id=str(old_cover.id)
    )
    scene = _scene(created, "Rain")
    old_blob = old_clip.blob.name
    assert default_storage.exists(old_blob)

    new_clip = _clip(admin, 25)
    with django_capture_on_commit_callbacks(execute=True):
        replaced = client.patch(
            f"{ADMIN_URL}/{scene['id']}",
            {
                "expected_revision": scene["revision"],
                "media_file_id": str(new_clip.id),
                "cover_file_id": None,
                "title": "Rain, again",
            },
            format="json",
        )
    assert replaced.status_code == 200, replaced.content
    updated = _scene(replaced.json(), "Rain, again")
    assert updated["media"]["id"] == str(new_clip.id)
    assert updated["media"]["duration_ms"] == 25_000
    assert updated["cover"] is None
    assert not ManagedFile.objects.filter(id__in=[old_clip.id, old_cover.id]).exists()
    assert not default_storage.exists(old_blob)

    new_blob = new_clip.blob.name
    with django_capture_on_commit_callbacks(execute=True):
        deleted = client.delete(
            f"{ADMIN_URL}/{scene['id']}", {"expected_revision": updated["revision"]}, format="json"
        )
    assert deleted.json()["scenes"] == []
    assert not ManagedFile.objects.filter(id=new_clip.id).exists()
    assert not default_storage.exists(new_blob)
    actions = set(
        AuditRecord.objects.filter(target_type="focus.lofi_scene").values_list("action", flat=True)
    )
    assert actions == {
        "focus.lofi_scene_created",
        "focus.lofi_scene_updated",
        "focus.lofi_scene_deleted",
    }


def test_a_file_still_used_by_another_scene_is_kept(
    django_capture_on_commit_callbacks: Callable[..., Any],
) -> None:
    admin = create_admin()
    client = _client(admin)
    shared = _clip(admin)
    _create(client, title="One", media_file_id=str(shared.id))
    payload = _create(client, title="Two", media_file_id=str(shared.id))
    two = _scene(payload, "Two")
    with django_capture_on_commit_callbacks(execute=True):
        client.delete(
            f"{ADMIN_URL}/{two['id']}", {"expected_revision": two["revision"]}, format="json"
        )
    assert ManagedFile.objects.filter(id=shared.id).exists()


def test_disabling_and_stale_edits() -> None:
    admin = create_admin()
    client = _client(admin)
    scene = _scene(_create(client, title="Rain", media_file_id=str(_clip(admin).id)), "Rain")
    disabled = client.patch(
        f"{ADMIN_URL}/{scene['id']}",
        {"expected_revision": scene["revision"], "enabled": False},
        format="json",
    )
    assert disabled.status_code == 200
    assert _client(_student()).get(STUDENT_URL).json() == {"scenes": []}
    stale = client.patch(
        f"{ADMIN_URL}/{scene['id']}",
        {"expected_revision": scene["revision"], "enabled": True},
        format="json",
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "lofi_scene_conflict"
    missing = client.patch(f"{ADMIN_URL}/{uuid4()}", {"expected_revision": 1}, format="json")
    assert missing.status_code == 404


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({"title": "   "}, "Give the scene a title."),
        ({"title": "x" * 81}, "under 80 characters"),
    ],
)
def test_invalid_scenes_are_rejected_with_a_reason(fields: dict[str, Any], message: str) -> None:
    admin = create_admin()
    response = _client(admin).post(
        ADMIN_URL, {"media_file_id": str(_clip(admin).id), **fields}, format="json"
    )
    assert response.status_code == 400
    assert message in response.json()["error"]["message"]


def test_foreign_files_and_video_covers_are_refused() -> None:
    admin = create_admin()
    client = _client(admin)
    avatar = create_managed_file(
        owner=admin,
        upload=SimpleUploadedFile("a.png", PNG, content_type="image/png"),
        kind=ManagedFile.Kind.AVATAR,
    )
    refused = client.post(ADMIN_URL, {"title": "X", "media_file_id": str(avatar.id)}, format="json")
    assert refused.status_code == 400
    assert "Lo-Fi media" in refused.json()["error"]["message"]
    clip = _clip(admin)
    video_cover = client.post(
        ADMIN_URL,
        {"title": "X", "media_file_id": str(clip.id), "cover_file_id": str(_clip(admin).id)},
        format="json",
    )
    assert video_cover.status_code == 400
    assert "cover must be" in video_cover.json()["error"]["message"]


def test_only_content_managers_can_change_scenes() -> None:
    student = _student()
    assert _client(student).get(ADMIN_URL).status_code == 403
    assert _client(student).post(ADMIN_URL, {"title": "X"}, format="json").status_code == 403
    assert (
        _client(student).put(f"{ADMIN_URL}/order", {"scene_ids": []}, format="json").status_code
        == 403
    )
    assert APIClient().get(STUDENT_URL).status_code in {401, 403}


def test_students_can_stream_published_clips_only_and_the_browser_may_keep_them() -> None:
    admin = create_admin()
    student_client = _client(_student())
    clip = _clip(admin)
    unpublished = _clip(admin)
    _create(_client(admin), title="Rain", media_file_id=str(clip.id))
    url = f"/api/v1/files/{clip.id}/view"

    full = student_client.get(url)
    assert full.status_code == 200
    body = b"".join(full.streaming_content)
    assert body == mp4(20)
    assert full["Cache-Control"] == "private, max-age=31536000, immutable"
    assert full["ETag"] == f'"{clip.id}"'
    assert full["Accept-Ranges"] == "bytes"

    # A looping <video> asks for byte ranges; those are cacheable too.
    part = student_client.get(url, HTTP_RANGE="bytes=0-99")
    assert part.status_code == 206
    assert part["Content-Range"] == f"bytes 0-99/{len(body)}"
    assert part["Cache-Control"] == "private, max-age=31536000, immutable"

    # A revalidation costs nothing: no body is sent again.
    again = student_client.get(url, HTTP_IF_NONE_MATCH=f'"{clip.id}"')
    assert again.status_code == 304
    assert not again.content

    assert student_client.get(f"/api/v1/files/{unpublished.id}/view").status_code == 404


def test_other_private_files_are_still_never_cached() -> None:
    admin = create_admin()
    avatar = create_managed_file(
        owner=admin,
        upload=SimpleUploadedFile("a.png", PNG, content_type="image/png"),
        kind=ManagedFile.Kind.AVATAR,
    )
    response = _client(admin).get(f"/api/v1/files/{avatar.id}/view")
    assert response.status_code == 200
    assert response["Cache-Control"] == "private, no-store"
    assert "ETag" not in response

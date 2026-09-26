from datetime import timedelta
from uuid import uuid4

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.audit.models import AuditRecord
from apps.education.tests.helpers import create_admin
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.files.models import ManagedFile
from apps.files.services import FileValidationError, create_managed_file

pytestmark = pytest.mark.django_db

ADMIN_URL = "/api/v1/operations/admin/paper-workspace/media"
STUDENT_URL = "/api/v1/focus/paper-workspace/media"
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64


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
    student = create_user(email="paper-student@example.com")
    _grant(student, "focus.workspace")
    _grant(student, "content.premium")
    return student


def _upload(
    admin: User, *, name: str = "lofi.mp4", body: bytes = MP4, content_type: str = "video/mp4"
) -> ManagedFile:
    return create_managed_file(
        owner=admin,
        upload=SimpleUploadedFile(name, body, content_type=content_type),
        kind=ManagedFile.Kind.WORKSPACE_MEDIA,
    )


def test_workspace_media_accepts_video_and_images_and_rejects_mismatched_files() -> None:
    admin = create_admin()
    assert _upload(admin).content_type == "video/mp4"
    webm = _upload(
        admin,
        name="lofi.webm",
        body=bytes.fromhex("1a45dfa3") + b"\x00" * 32,
        content_type="video/webm",
    )
    assert webm.content_type == "video/webm"
    gif = _upload(admin, name="cat.gif", body=b"GIF89a" + b"\x00" * 32, content_type="image/gif")
    assert gif.content_type == "image/gif"
    with pytest.raises(FileValidationError):
        _upload(admin, name="lofi.mp4", body=b"not a video" * 4)
    with pytest.raises(FileValidationError):
        _upload(admin, name="notes.pdf", body=b"%PDF-1.7\n", content_type="application/pdf")


def test_students_get_the_lofi_scene_until_media_is_published() -> None:
    admin = create_admin()
    student = _student()
    assert _client(student).get(STUDENT_URL).json() == {"media": None}

    media = _upload(admin)
    client = _client(admin)
    state = client.get(ADMIN_URL).json()
    assert state["file"] is None and state["recommended"]["aspect_ratio"] == "16:9"

    # Uploaded but not yet enabled: still hidden from students, previewable by admins.
    saved = client.put(
        ADMIN_URL,
        {
            "expected_revision": 0,
            "file_id": str(media.id),
            "enabled": False,
            "focal_x": 40,
            "focal_y": 60,
        },
        format="json",
    )
    assert saved.status_code == 200, saved.content
    assert saved.json()["file"]["media_type"] == "video"
    assert _client(student).get(STUDENT_URL).json() == {"media": None}
    assert _client(student).get(f"/api/v1/files/{media.id}/view").status_code == 404
    assert client.get(f"/api/v1/files/{media.id}/view").status_code == 200

    enabled = client.put(
        ADMIN_URL,
        {"expected_revision": 1, "enabled": True, "focal_x": 40, "focal_y": 60},
        format="json",
    )
    assert enabled.status_code == 200, enabled.content
    published = _client(student).get(STUDENT_URL).json()["media"]
    assert published["url"] == f"/api/v1/files/{media.id}/view"
    assert (published["focal_x"], published["focal_y"], published["media_type"]) == (
        40,
        60,
        "video",
    )
    viewed = _client(student).get(f"/api/v1/files/{media.id}/view", HTTP_RANGE="bytes=0-9")
    assert viewed.status_code == 206
    assert _client(student).get(f"/api/v1/files/{media.id}/download").status_code == 404
    assert AuditRecord.objects.filter(action="focus.paper_workspace_media_saved").count() == 2


def test_a_stale_revision_is_rejected_and_removal_restores_the_lofi_scene() -> None:
    admin = create_admin()
    media = _upload(admin)
    client = _client(admin)
    body = {
        "expected_revision": 0,
        "file_id": str(media.id),
        "enabled": True,
        "focal_x": 50,
        "focal_y": 50,
    }
    assert client.put(ADMIN_URL, body, format="json").status_code == 200
    assert client.put(ADMIN_URL, body, format="json").status_code == 409

    removed = client.delete(ADMIN_URL, {"expected_revision": 1}, format="json")
    assert removed.status_code == 200
    assert removed.json()["file"] is None and removed.json()["enabled"] is False
    assert _client(_student()).get(STUDENT_URL).json() == {"media": None}


def test_enabling_without_media_and_foreign_files_are_rejected() -> None:
    admin = create_admin()
    client = _client(admin)
    empty = client.put(
        ADMIN_URL,
        {"expected_revision": 0, "enabled": True, "focal_x": 50, "focal_y": 50},
        format="json",
    )
    assert empty.status_code == 400
    pdf = create_managed_file(
        owner=admin,
        upload=SimpleUploadedFile("sheet.pdf", b"%PDF-1.7\n%x\n", content_type="application/pdf"),
        kind=ManagedFile.Kind.PDF,
    )
    wrong = client.put(
        ADMIN_URL,
        {
            "expected_revision": 0,
            "file_id": str(pdf.id),
            "enabled": True,
            "focal_x": 50,
            "focal_y": 50,
        },
        format="json",
    )
    assert wrong.status_code == 400


def test_only_content_managers_can_change_the_media() -> None:
    student = _student()
    assert _client(student).get(ADMIN_URL).status_code == 403
    assert (
        _client(student)
        .put(
            ADMIN_URL,
            {"expected_revision": 0, "enabled": False, "focal_x": 50, "focal_y": 50},
            format="json",
        )
        .status_code
        == 403
    )
    assert APIClient().get(STUDENT_URL).status_code in {401, 403}

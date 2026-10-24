"""Delivery reads a verified shared copy, and every access rule still applies first."""

from pathlib import Path
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, pdf_upload, published_path
from apps.files.models import ManagedFile
from apps.files.services import create_managed_file
from platform_core import object_cache

from .helpers import close_streamed
from .test_subscription_gate import expire_access

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def cache_enabled(tmp_path: Path, settings: Any) -> None:
    settings.MANAGED_OBJECT_CACHE_DIR = str(tmp_path / "object-cache")
    settings.MANAGED_OBJECT_CACHE_MAX_BYTES = 64 * 1024 * 1024


def _cache(managed_file: ManagedFile) -> bytes:
    """Fill the shared copy, then take the provider's object away."""

    blob = managed_file.blob
    with blob.storage.open(blob.name, "rb") as handle:
        original = handle.read()
    assert object_cache.fill(
        storage=blob.storage,
        name=blob.name,
        size=len(original),
        checksum=managed_file.checksum_sha256,
    )
    blob.storage.delete(blob.name)
    return original


def _body(response: Any) -> bytes:
    try:
        return b"".join(response.streaming_content)
    finally:
        close_streamed(response)


def _sheet() -> tuple[Any, ManagedFile]:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    learning_object = published_pdf(actor=admin, node=lesson)
    assert learning_object.published_version is not None
    asset = learning_object.published_version.assets.get(role="primary")
    return admin, asset.managed_file


def test_a_cached_sheet_is_served_whole_and_by_range_without_the_provider() -> None:
    _, managed_file = _sheet()
    original = _cache(managed_file)
    student = create_user(email="cache-reader@example.com", with_trial=True)
    client = APIClient()
    client.force_authenticate(student)

    whole = client.get(f"/api/v1/files/{managed_file.id}/view")
    assert whole.status_code == 200
    assert _body(whole) == original

    ranged = client.get(f"/api/v1/files/{managed_file.id}/view", HTTP_RANGE="bytes=5-20")
    assert ranged.status_code == 206
    assert ranged["Content-Range"] == f"bytes 5-20/{len(original)}"
    assert _body(ranged) == original[5:21]


def test_a_cached_copy_never_bypasses_the_subscription_gate() -> None:
    _, managed_file = _sheet()
    _cache(managed_file)
    student = create_user(email="cache-expired@example.com", with_trial=True)
    expire_access(student)
    client = APIClient()
    client.force_authenticate(student)

    refused = client.get(f"/api/v1/files/{managed_file.id}/view")

    assert refused.status_code == 403


def test_a_cached_copy_never_bypasses_a_quarantine() -> None:
    _, managed_file = _sheet()
    _cache(managed_file)
    ManagedFile.objects.filter(id=managed_file.id).update(
        scan_status=ManagedFile.ScanStatus.QUARANTINED
    )
    student = create_user(email="cache-quarantine@example.com", with_trial=True)
    client = APIClient()
    client.force_authenticate(student)

    assert client.get(f"/api/v1/files/{managed_file.id}/view").status_code == 404


def test_deleting_a_file_removes_its_shared_copy() -> None:
    admin = create_admin()
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")
    name = managed_file.blob.name
    _cache(managed_file)
    cached = object_cache.open_cached(name)
    assert cached is not None
    cached[0].close()

    managed_file.delete()

    assert object_cache.open_cached(name) is None

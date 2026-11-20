"""Per-sheet export policy: immediate, audited, and independent of PDF revisions."""

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.audit.models import AuditRecord
from apps.content.admin_services import replace_pdf
from apps.content.models import LearningObject, LearningObjectAsset
from apps.content.serializers import LearningObjectAssetSerializer
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, pdf_upload, published_path
from apps.files.services import create_managed_file

pytestmark = pytest.mark.django_db


def test_admin_blocks_download_without_unpublishing_or_hiding_reader(settings) -> None:
    settings.COHORT_CONTENT_ENFORCEMENT = False
    admin = create_admin()
    student = create_user(with_trial=True)
    _, _, lesson = published_path(admin=admin)
    sheet = published_pdf(actor=admin, node=lesson, allow_download=True)
    assert sheet.published_version is not None
    original_version = sheet.published_version_id
    asset = sheet.published_version.assets.get(role=LearningObjectAsset.Role.PRIMARY)
    file_id = asset.managed_file_id
    route = f"/api/v1/operations/admin/content/sheets/{sheet.id}"

    reader = APIClient()
    reader.force_authenticate(student)
    assert reader.get(f"/api/v1/files/{file_id}/download").status_code == 200
    assert reader.get(f"/api/v1/files/{file_id}/view").status_code == 200

    operator = APIClient()
    operator.force_authenticate(admin)
    response = operator.patch(
        route, {"expected_revision": sheet.revision, "block_file_export": True},
        format="json",
    )
    assert response.status_code == 200, response.content
    assert response.json()["block_file_export"] is True

    sheet.refresh_from_db()
    assert sheet.workflow_status == LearningObject.WorkflowStatus.PUBLISHED
    assert sheet.published_version_id == original_version
    assert sheet.current_version_id == original_version
    assert sheet.revision > 1
    assert reader.get(f"/api/v1/files/{file_id}/download").status_code == 404
    assert reader.get(f"/api/v1/files/{file_id}/view").status_code == 200
    assert LearningObjectAssetSerializer(asset).data["download_url"] is None
    assert AuditRecord.objects.filter(
        target_id=str(sheet.id), action="content.sheet_export_policy_updated"
    ).exists()

    forbidden = reader.patch(
        route, {"expected_revision": sheet.revision, "block_file_export": False},
        format="json",
    )
    assert forbidden.status_code == 403
    stale = operator.patch(
        route, {"expected_revision": sheet.revision - 1, "block_file_export": False},
        format="json",
    )
    assert stale.status_code == 409

    restored = operator.patch(
        route, {"expected_revision": sheet.revision, "block_file_export": False},
        format="json",
    )
    assert restored.status_code == 200, restored.content
    assert reader.get(f"/api/v1/files/{file_id}/download").status_code == 200


def test_block_survives_replacing_pdf_and_missing_lockin_edition() -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    sheet = published_pdf(actor=admin, node=lesson, allow_download=True)
    assert sheet.current_version is not None
    assert not sheet.current_version.assets.filter(
        role=LearningObjectAsset.Role.LOCKIN_PRIMARY
    ).exists()

    operator = APIClient()
    operator.force_authenticate(admin)
    blocked = operator.patch(
        f"/api/v1/operations/admin/content/sheets/{sheet.id}",
        {"expected_revision": sheet.revision, "block_file_export": True},
        format="json",
    )
    assert blocked.status_code == 200, blocked.content
    sheet.refresh_from_db()
    replacement = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")
    changed = replace_pdf(
        actor=admin,
        sheet_id=sheet.id,
        expected_revision=sheet.revision,
        managed_file=replacement,
        notify_students=False,
    )
    assert changed.block_file_export is True
    assert changed.workflow_status == LearningObject.WorkflowStatus.PUBLISHED

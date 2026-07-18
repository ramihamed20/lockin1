from uuid import UUID

from rest_framework.exceptions import NotFound

from apps.accounts.models import User
from apps.content.models import LearningObject, LearningObjectAsset, LearningObjectVersion
from apps.content.policies import can_view_learning_object
from apps.files.models import ManagedFile

from .domain_types import FocusDocumentReference


def resolve_focus_document(*, user: User, document_version_id: UUID) -> FocusDocumentReference:
    learning_object = (
        LearningObject.objects.filter(
            published_version_id=document_version_id,
            archived_at__isnull=True,
        )
        .select_related("published_version__academic_node")
        .first()
    )
    if learning_object is None or not can_view_learning_object(
        user=user, learning_object=learning_object
    ):
        raise NotFound("Focus document not found.")
    version = learning_object.published_version
    if version is None or version.content_type != LearningObjectVersion.ContentType.PDF:
        raise NotFound("Focus document not found.")
    asset = (
        LearningObjectAsset.objects.filter(
            version=version,
            role=LearningObjectAsset.Role.PRIMARY,
            managed_file__validation_status=ManagedFile.ValidationStatus.READY,
        )
        .select_related("managed_file")
        .order_by("position", "id")
        .first()
    )
    if asset is None or asset.managed_file.content_type != "application/pdf":
        raise NotFound("Focus document not found.")
    raw_page_count = version.metadata.get("page_count")
    page_count = (
        raw_page_count
        if isinstance(raw_page_count, int)
        and not isinstance(raw_page_count, bool)
        and 1 <= raw_page_count <= 10_000
        else None
    )
    return FocusDocumentReference(
        document_id=learning_object.id,
        document_version_id=version.id,
        file_id=asset.managed_file_id,
        title=version.title,
        language=version.language,
        view_url=f"/api/v1/files/{asset.managed_file_id}/view",
        size_bytes=asset.managed_file.size_bytes,
        checksum_sha256=asset.managed_file.checksum_sha256,
        page_count=page_count,
    )

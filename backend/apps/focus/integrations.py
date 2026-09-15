from uuid import UUID

from rest_framework.exceptions import NotFound

from apps.accounts.models import User
from apps.content.edition_documents import edition_asset, edition_page_count
from apps.content.editions import (
    STUDY,
    UNIVERSITY,
    annotation_document_id,
    normalize_edition,
    normalize_view,
)
from apps.content.models import LearningObject, LearningObjectVersion
from apps.content.policies import can_view_learning_object

from .domain_types import FocusDocumentReference


def resolve_focus_document(
    *,
    user: User,
    document_version_id: UUID,
    edition: str = UNIVERSITY,
    view: str = STUDY,
) -> FocusDocumentReference:
    """Resolve the one PDF a reader is looking at.

    A sheet publishes two editions from one version, and each edition also has a
    Sheet Summary, so the version alone no longer names a document. The edition
    and view pick the file, its page count, and the identity its annotations and
    reading position are stored under.
    """

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
    edition = normalize_edition(edition)
    view = normalize_view(view)
    # The same rule the Catalog resolver uses, so the file a reader opens and
    # the collection their marks land in can never disagree.
    asset, owning_edition = edition_asset(version=version, edition=edition, view=view)
    if asset is None or asset.managed_file.content_type != "application/pdf":
        raise NotFound("Focus document not found.")
    page_count = edition_page_count(version=version, asset=asset, edition=owning_edition, view=view)
    return FocusDocumentReference(
        document_id=annotation_document_id(
            learning_object_id=learning_object.id, edition=owning_edition, view=view
        ),
        document_version_id=version.id,
        file_id=asset.managed_file_id,
        title=version.title,
        language=version.language,
        view_url=f"/api/v1/files/{asset.managed_file_id}/view",
        size_bytes=asset.managed_file.size_bytes,
        checksum_sha256=asset.managed_file.checksum_sha256,
        page_count=page_count,
    )

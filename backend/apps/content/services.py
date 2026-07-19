from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.discovery.indexing import remove_search_entry, upsert_search_entry
from apps.education.models import EducationNode
from apps.education.policies import (
    can_create_content,
    can_publish_content,
    can_review_content,
    is_administrator,
)
from apps.files.models import ManagedFile
from platform_core.events import publish_after_commit

from .events import ContentPublished
from .models import LearningObject, LearningObjectAsset, LearningObjectVersion
from .policies import can_edit_learning_object


class ContentRuleError(ValueError):
    pass


class ContentConflictError(ContentRuleError):
    pass


@dataclass(frozen=True, slots=True)
class LearningObjectInput:
    academic_node: EducationNode
    content_type: str
    title: str
    summary: str = ""
    language: str = "en"
    allow_download: bool = False
    metadata: dict[str, object] = field(default_factory=dict)
    available_from: datetime | None = None
    available_until: datetime | None = None
    primary_file: ManagedFile | None = None


def _validate_input(*, actor: User, data: LearningObjectInput) -> None:
    if not can_create_content(user=actor, node=data.academic_node):
        raise ContentRuleError("You cannot create content in this education scope.")
    if not data.title.strip():
        raise ContentRuleError("A content title is required.")
    if data.available_from and data.available_until and data.available_until <= data.available_from:
        raise ContentRuleError("Availability must end after it starts.")
    if data.content_type == LearningObjectVersion.ContentType.VIDEO:
        if data.primary_file is not None:
            raise ContentRuleError("Video delivery is not implemented in this phase.")
        return
    if data.primary_file is None:
        raise ContentRuleError("A primary file is required for PDF and audio content.")
    if not is_administrator(actor) and data.primary_file.owner_id != actor.id:
        raise ContentRuleError("You cannot attach another creator's file.")
    if data.primary_file.validation_status != ManagedFile.ValidationStatus.READY:
        raise ContentRuleError("The selected file did not pass validation.")
    expected_kinds: dict[str, str] = {
        LearningObjectVersion.ContentType.PDF: ManagedFile.Kind.PDF,
        LearningObjectVersion.ContentType.AUDIO: ManagedFile.Kind.AUDIO,
    }
    expected_kind = expected_kinds.get(data.content_type)
    if expected_kind is None or data.primary_file.kind != expected_kind:
        raise ContentRuleError("The primary file does not match the content type.")


def _create_version(
    *,
    learning_object: LearningObject,
    actor: User,
    version_number: int,
    data: LearningObjectInput,
) -> LearningObjectVersion:
    version = LearningObjectVersion.objects.create(
        learning_object=learning_object,
        version_number=version_number,
        academic_node=data.academic_node,
        content_type=data.content_type,
        title=data.title.strip(),
        summary=data.summary.strip(),
        language=data.language,
        allow_download=data.allow_download,
        metadata=data.metadata,
        available_from=data.available_from,
        available_until=data.available_until,
        created_by=actor,
    )
    if data.primary_file is not None:
        LearningObjectAsset.objects.create(
            version=version,
            managed_file=data.primary_file,
            role=LearningObjectAsset.Role.PRIMARY,
        )
    return version


def _ensure_revision(*, learning_object: LearningObject, expected_revision: int) -> None:
    if learning_object.revision != expected_revision:
        raise ContentConflictError("This content changed. Reload it and try again.")


@transaction.atomic
def create_learning_object(*, actor: User, data: LearningObjectInput) -> LearningObject:
    _validate_input(actor=actor, data=data)
    learning_object = LearningObject.objects.create(owner=actor)
    version = _create_version(
        learning_object=learning_object,
        actor=actor,
        version_number=1,
        data=data,
    )
    learning_object.current_version = version
    learning_object.save(update_fields=("current_version", "updated_at"))
    return LearningObject.objects.select_related("current_version").get(id=learning_object.id)


@transaction.atomic
def revise_learning_object(
    *,
    actor: User,
    learning_object_id: UUID,
    expected_revision: int,
    data: LearningObjectInput,
) -> LearningObject:
    learning_object = (
        LearningObject.objects.select_for_update()
        .select_related("current_version", "published_version")
        .get(id=learning_object_id)
    )
    if not can_edit_learning_object(user=actor, learning_object=learning_object):
        raise ContentRuleError("You cannot edit this content.")
    _ensure_revision(learning_object=learning_object, expected_revision=expected_revision)
    if learning_object.workflow_status in {
        LearningObject.WorkflowStatus.IN_REVIEW,
        LearningObject.WorkflowStatus.ARCHIVED,
    }:
        raise ContentRuleError("Content in review or archived content cannot be edited.")
    _validate_input(actor=actor, data=data)
    current = learning_object.current_version
    if current is None:
        raise ContentRuleError("The content has no current version.")
    version = _create_version(
        learning_object=learning_object,
        actor=actor,
        version_number=current.version_number + 1,
        data=data,
    )
    learning_object.current_version = version
    learning_object.workflow_status = LearningObject.WorkflowStatus.DRAFT
    learning_object.review_note = ""
    learning_object.revision += 1
    learning_object.save(
        update_fields=(
            "current_version",
            "workflow_status",
            "review_note",
            "revision",
            "updated_at",
        )
    )
    return LearningObject.objects.select_related("current_version", "published_version").get(
        id=learning_object.id
    )


def _validate_reviewable(version: LearningObjectVersion) -> None:
    if version.content_type == LearningObjectVersion.ContentType.VIDEO:
        return
    primary = (
        version.assets.select_related("managed_file")
        .filter(role=LearningObjectAsset.Role.PRIMARY)
        .first()
    )
    if (
        primary is None
        or primary.managed_file.validation_status != ManagedFile.ValidationStatus.READY
    ):
        raise ContentRuleError("A validated primary file is required before publication.")
    if primary.managed_file.scan_status in {
        ManagedFile.ScanStatus.QUARANTINED,
        ManagedFile.ScanStatus.FAILED,
    } or (
        settings.CONTENT_REQUIRE_CLEAN_SCAN
        and primary.managed_file.scan_status != ManagedFile.ScanStatus.CLEAN
    ):
        raise ContentRuleError("The primary file is not safe to publish.")


def _validate_publishable(version: LearningObjectVersion) -> None:
    if not version.academic_node.is_discoverable:
        raise ContentRuleError("Publish the education path before publishing this content.")
    _validate_reviewable(version)
    if version.content_type == LearningObjectVersion.ContentType.VIDEO:
        raise ContentRuleError("Video delivery is future-ready but is not implemented yet.")


@transaction.atomic
def submit_for_review(
    *, actor: User, learning_object_id: UUID, expected_revision: int
) -> LearningObject:
    learning_object = (
        LearningObject.objects.select_for_update()
        .select_related("current_version__academic_node")
        .get(id=learning_object_id)
    )
    if not can_edit_learning_object(user=actor, learning_object=learning_object):
        raise ContentRuleError("You cannot submit this content.")
    _ensure_revision(learning_object=learning_object, expected_revision=expected_revision)
    if learning_object.workflow_status not in {
        LearningObject.WorkflowStatus.DRAFT,
        LearningObject.WorkflowStatus.REJECTED,
    }:
        raise ContentRuleError("Only draft or rejected content can be submitted.")
    if learning_object.current_version is None:
        raise ContentRuleError("The content has no current version.")
    _validate_reviewable(learning_object.current_version)
    learning_object.workflow_status = LearningObject.WorkflowStatus.IN_REVIEW
    learning_object.review_note = ""
    learning_object.revision += 1
    learning_object.save(update_fields=("workflow_status", "review_note", "revision", "updated_at"))
    return learning_object


@transaction.atomic
def reject_learning_object(
    *, actor: User, learning_object_id: UUID, expected_revision: int, review_note: str
) -> LearningObject:
    learning_object = (
        LearningObject.objects.select_for_update()
        .select_related("current_version__academic_node")
        .get(id=learning_object_id)
    )
    version = learning_object.current_version
    if version is None or not can_review_content(user=actor, node=version.academic_node):
        raise ContentRuleError("You cannot review this content.")
    _ensure_revision(learning_object=learning_object, expected_revision=expected_revision)
    if learning_object.workflow_status != LearningObject.WorkflowStatus.IN_REVIEW:
        raise ContentRuleError("Only content in review can be rejected.")
    if not review_note.strip():
        raise ContentRuleError("Review feedback is required when rejecting content.")
    learning_object.workflow_status = LearningObject.WorkflowStatus.REJECTED
    learning_object.review_note = review_note.strip()
    learning_object.revision += 1
    learning_object.save(update_fields=("workflow_status", "review_note", "revision", "updated_at"))
    return learning_object


@transaction.atomic
def publish_learning_object(
    *, actor: User, learning_object_id: UUID, expected_revision: int
) -> LearningObject:
    learning_object = (
        LearningObject.objects.select_for_update()
        .select_related("current_version__academic_node")
        .get(id=learning_object_id)
    )
    version = learning_object.current_version
    if version is None or not can_publish_content(user=actor, node=version.academic_node):
        raise ContentRuleError("You cannot publish this content.")
    _ensure_revision(learning_object=learning_object, expected_revision=expected_revision)
    if learning_object.workflow_status != LearningObject.WorkflowStatus.IN_REVIEW:
        raise ContentRuleError("Only reviewed content can be published.")
    _validate_publishable(version)
    now = timezone.now()
    learning_object.published_version = version
    learning_object.workflow_status = LearningObject.WorkflowStatus.PUBLISHED
    learning_object.published_at = now
    learning_object.archived_at = None
    learning_object.review_note = ""
    learning_object.revision += 1
    learning_object.save(
        update_fields=(
            "published_version",
            "workflow_status",
            "published_at",
            "archived_at",
            "review_note",
            "revision",
            "updated_at",
        )
    )
    upsert_search_entry(
        resource_kind="learning_object",
        resource_id=learning_object.id,
        title=version.title,
        summary=version.summary,
        academic_path=version.academic_node.path,
        language=version.language,
        content_type=version.content_type,
        published_at=now,
    )
    publish_after_commit(
        ContentPublished(
            learning_object_id=learning_object.id,
            version_id=version.id,
            academic_node_id=version.academic_node_id,
            content_type=version.content_type,
            actor_id=actor.id,
        )
    )
    return learning_object


@transaction.atomic
def archive_learning_object(
    *, actor: User, learning_object_id: UUID, expected_revision: int
) -> LearningObject:
    learning_object = (
        LearningObject.objects.select_for_update()
        .select_related("current_version__academic_node")
        .get(id=learning_object_id)
    )
    version = learning_object.current_version
    if version is None or not can_publish_content(user=actor, node=version.academic_node):
        raise ContentRuleError("You cannot archive this content.")
    _ensure_revision(learning_object=learning_object, expected_revision=expected_revision)
    learning_object.workflow_status = LearningObject.WorkflowStatus.ARCHIVED
    learning_object.archived_at = timezone.now()
    learning_object.revision += 1
    learning_object.save(update_fields=("workflow_status", "archived_at", "revision", "updated_at"))
    remove_search_entry(resource_kind="learning_object", resource_id=learning_object.id)
    return learning_object


@transaction.atomic
def transfer_learning_object(
    *,
    actor: User,
    learning_object_id: UUID,
    new_owner: User,
    expected_revision: int,
) -> LearningObject:
    if not is_administrator(actor):
        raise ContentRuleError("Only administrators can transfer content ownership.")
    learning_object = LearningObject.objects.select_for_update().get(id=learning_object_id)
    _ensure_revision(learning_object=learning_object, expected_revision=expected_revision)
    learning_object.owner = new_owner
    learning_object.revision += 1
    learning_object.save(update_fields=("owner", "revision", "updated_at"))
    return learning_object

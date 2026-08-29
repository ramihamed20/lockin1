from __future__ import annotations

from uuid import UUID

from django.db import transaction

from apps.accounts.models import User
from apps.audit.models import AuditRecord
from apps.audit.services import record_audit
from apps.discovery.indexing import remove_search_entry
from apps.education.models import EducationNode
from apps.files.models import ManagedFile
from apps.notifications.models import Notification
from apps.notifications.services import create_notification

from .models import LearningObject, LearningObjectAsset, LearningObjectVersion
from .services import (
    ContentConflictError,
    ContentRuleError,
    LearningObjectInput,
    archive_learning_object,
    create_learning_object,
    publish_learning_object,
    revise_learning_object,
    submit_for_review,
)


def has_publication_history(sheet: LearningObject) -> bool:
    return (
        sheet.published_at is not None
        or sheet.published_version_id is not None
        or AuditRecord.objects.filter(
            target_type="content.learning_object",
            target_id=str(sheet.id),
            new_state__workflow_status=LearningObject.WorkflowStatus.PUBLISHED,
        ).exists()
    )


def _audit(
    *, actor: User, action: str, sheet: LearningObject, previous: dict[str, object] | None = None
) -> None:
    record_audit(
        actor=actor,
        action=action,
        domain="content",
        target_type="content.learning_object",
        target_id=str(sheet.id),
        reason="Content management action.",
        source="content_management.api",
        previous_state=previous or {},
        new_state={
            "workflow_status": sheet.workflow_status,
            "revision": sheet.revision,
            "position": sheet.position,
            "current_version_id": str(sheet.current_version_id or ""),
            "published_version_id": str(sheet.published_version_id or ""),
        },
    )


def _subject_for_node(node: EducationNode) -> EducationNode:
    current: EducationNode | None = node
    while current is not None:
        if current.kind == EducationNode.Kind.SUBJECT:
            return current
        current = (
            EducationNode.objects.filter(id=current.parent_id).first()
            if current.parent_id is not None
            else None
        )
    raise ContentRuleError("The sheet is not inside a subject.")


def _notify_students(*, actor: User, sheet: LearningObject) -> int:
    version = sheet.published_version
    if version is None:
        return 0
    subject = _subject_for_node(version.academic_node)
    recipients = User.objects.filter(status=User.Status.ACTIVE, is_active=True).exclude(id=actor.id)
    created = 0
    for recipient_id in recipients.values_list("id", flat=True).iterator():
        _, was_created = create_notification(
            recipient_id=recipient_id,
            actor_id=actor.id,
            category=Notification.Category.LEARNING,
            template_key="content.sheet_published",
            title="New sheet available",
            body=f"{version.title} — {subject.title}",
            deduplication_key=f"sheet-published:{sheet.id}:{version.id}",
            data={
                "group_key": f"new-sheets:{subject.id}",
                "subject_id": str(subject.id),
                "sheet_id": str(sheet.id),
            },
            target_type="learning_object",
            target_id=sheet.id,
            target_route=f"/materials/objects/{sheet.id}",
        )
        created += int(was_created)
    return created


def _publish_current(*, actor: User, sheet: LearningObject) -> LearningObject:
    if sheet.workflow_status == LearningObject.WorkflowStatus.PUBLISHED:
        return sheet
    if sheet.workflow_status == LearningObject.WorkflowStatus.ARCHIVED:
        raise ContentRuleError("Archived sheets cannot be published without restoration.")
    if sheet.workflow_status != LearningObject.WorkflowStatus.IN_REVIEW:
        sheet = submit_for_review(
            actor=actor,
            learning_object_id=sheet.id,
            expected_revision=sheet.revision,
        )
    return publish_learning_object(
        actor=actor,
        learning_object_id=sheet.id,
        expected_revision=sheet.revision,
    )


@transaction.atomic
def create_sheet(
    *,
    actor: User,
    subject: EducationNode,
    managed_file: ManagedFile,
    title: str,
    summary: str,
    position: int,
    publish: bool,
    notify_students: bool,
    allow_download: bool,
) -> LearningObject:
    if subject.kind != EducationNode.Kind.SUBJECT:
        raise ContentRuleError("Sheets must be created inside a subject.")
    sheet = create_learning_object(
        actor=actor,
        data=LearningObjectInput(
            academic_node=subject,
            content_type=LearningObjectVersion.ContentType.PDF,
            title=title,
            summary=summary,
            primary_file=managed_file,
            position=position,
            allow_download=allow_download,
        ),
    )
    if publish:
        sheet = _publish_current(actor=actor, sheet=sheet)
        if notify_students:
            _notify_students(actor=actor, sheet=sheet)
    _audit(actor=actor, action="content.sheet_created", sheet=sheet)
    return sheet


def _current_input(
    *, sheet: LearningObject, primary_file: ManagedFile | None, title: str | None = None,
    summary: str | None = None, position: int | None = None
) -> LearningObjectInput:
    version = sheet.current_version
    if version is None:
        raise ContentRuleError("The sheet has no current version.")
    return LearningObjectInput(
        academic_node=version.academic_node,
        content_type=LearningObjectVersion.ContentType.PDF,
        title=title if title is not None else version.title,
        summary=summary if summary is not None else version.summary,
        language=version.language,
        allow_download=version.allow_download,
        metadata=dict(version.metadata),
        available_from=version.available_from,
        available_until=version.available_until,
        primary_file=primary_file,
        position=sheet.position if position is None else position,
    )


def _primary_file(sheet: LearningObject) -> ManagedFile:
    version = sheet.current_version
    if version is None:
        raise ContentRuleError("The sheet has no current version.")
    asset = version.assets.select_related("managed_file").filter(
        role=LearningObjectAsset.Role.PRIMARY
    ).first()
    if asset is None:
        raise ContentRuleError("Upload a PDF before editing this sheet.")
    return asset.managed_file


@transaction.atomic
def update_sheet(
    *, actor: User, sheet_id: UUID, expected_revision: int, changes: dict[str, object]
) -> LearningObject:
    current = LearningObject.objects.select_related("current_version__academic_node").get(
        id=sheet_id
    )
    was_published = current.workflow_status == LearningObject.WorkflowStatus.PUBLISHED
    previous = {"workflow_status": current.workflow_status, "revision": current.revision}
    sheet = revise_learning_object(
        actor=actor,
        learning_object_id=sheet_id,
        expected_revision=expected_revision,
        data=_current_input(
            sheet=current,
            primary_file=_primary_file(current),
            title=str(changes["title"]) if "title" in changes else None,
            summary=str(changes["summary"]) if "summary" in changes else None,
            position=int(changes["position"]) if "position" in changes else None,
        ),
    )
    if was_published:
        sheet = _publish_current(actor=actor, sheet=sheet)
    _audit(actor=actor, action="content.sheet_updated", sheet=sheet, previous=previous)
    return sheet


@transaction.atomic
def replace_pdf(
    *, actor: User, sheet_id: UUID, expected_revision: int, managed_file: ManagedFile,
    notify_students: bool
) -> LearningObject:
    current = LearningObject.objects.select_related("current_version__academic_node").get(
        id=sheet_id
    )
    was_published = current.workflow_status == LearningObject.WorkflowStatus.PUBLISHED
    sheet = revise_learning_object(
        actor=actor,
        learning_object_id=sheet_id,
        expected_revision=expected_revision,
        data=_current_input(sheet=current, primary_file=managed_file),
    )
    if was_published:
        sheet = _publish_current(actor=actor, sheet=sheet)
        if notify_students:
            _notify_students(actor=actor, sheet=sheet)
    _audit(actor=actor, action="content.pdf_replaced", sheet=sheet)
    return sheet


@transaction.atomic
def unpublish_sheet(*, actor: User, sheet_id: UUID, expected_revision: int) -> LearningObject:
    sheet = LearningObject.objects.select_for_update().get(id=sheet_id)
    if sheet.revision != expected_revision:
        raise ContentConflictError("This content changed. Reload it and try again.")
    previous = {"workflow_status": sheet.workflow_status, "revision": sheet.revision}
    sheet.published_version = None
    sheet.workflow_status = LearningObject.WorkflowStatus.DRAFT
    sheet.published_at = None
    sheet.revision += 1
    sheet.save(
        update_fields=(
            "published_version",
            "workflow_status",
            "published_at",
            "revision",
            "updated_at",
        )
    )
    remove_search_entry(resource_kind="learning_object", resource_id=sheet.id)
    _audit(actor=actor, action="content.sheet_unpublished", sheet=sheet, previous=previous)
    return sheet


@transaction.atomic
def delete_pdf(*, actor: User, sheet_id: UUID, expected_revision: int) -> LearningObject:
    sheet = (
        LearningObject.objects.select_for_update()
        .select_related("current_version")
        .get(id=sheet_id)
    )
    if sheet.revision != expected_revision:
        raise ContentConflictError("This content changed. Reload it and try again.")
    version = sheet.current_version
    if version is None:
        raise ContentRuleError("The sheet has no current version.")
    replacement = LearningObjectVersion.objects.create(
        learning_object=sheet,
        version_number=version.version_number + 1,
        academic_node=version.academic_node,
        content_type=LearningObjectVersion.ContentType.PDF,
        title=version.title,
        summary=version.summary,
        language=version.language,
        allow_download=version.allow_download,
        metadata=version.metadata,
        available_from=version.available_from,
        available_until=version.available_until,
        created_by=actor,
    )
    sheet.current_version = replacement
    sheet.published_version = None
    sheet.workflow_status = LearningObject.WorkflowStatus.DRAFT
    sheet.published_at = None
    sheet.revision += 1
    sheet.save(
        update_fields=(
            "current_version",
            "published_version",
            "workflow_status",
            "published_at",
            "revision",
            "updated_at",
        )
    )
    remove_search_entry(resource_kind="learning_object", resource_id=sheet.id)
    _audit(actor=actor, action="content.pdf_removed", sheet=sheet)
    return sheet


@transaction.atomic
def change_sheet_status(
    *, actor: User, sheet_id: UUID, expected_revision: int, action: str, notify_students: bool
) -> LearningObject:
    sheet = LearningObject.objects.select_related("current_version__academic_node").get(id=sheet_id)
    if sheet.revision != expected_revision:
        raise ContentConflictError("This content changed. Reload it and try again.")
    if action == "publish":
        sheet = _publish_current(actor=actor, sheet=sheet)
        if notify_students:
            _notify_students(actor=actor, sheet=sheet)
        audit_action = "content.sheet_published"
    elif action == "unpublish":
        return unpublish_sheet(actor=actor, sheet_id=sheet.id, expected_revision=sheet.revision)
    elif action == "archive":
        sheet = archive_learning_object(
            actor=actor,
            learning_object_id=sheet.id,
            expected_revision=sheet.revision,
        )
        audit_action = "content.sheet_archived"
    else:
        raise ContentRuleError("Unsupported sheet action.")
    _audit(actor=actor, action=audit_action, sheet=sheet)
    return sheet


@transaction.atomic
def permanently_delete_sheet(*, actor: User, sheet_id: UUID) -> None:
    sheet = LearningObject.objects.select_for_update().get(id=sheet_id)
    dependencies = []
    if sheet.progress_records.exists():
        dependencies.append("student progress")
    if sheet.bookmarks.exists():
        dependencies.append("bookmarks")
    if sheet.question_versions.exists() or sheet.question_import_batches.exists():
        dependencies.append("questions")
    if has_publication_history(sheet):
        dependencies.append("publication history")
    if dependencies:
        raise ContentRuleError(
            "Permanent deletion is unsafe because this sheet has "
            + ", ".join(dependencies)
            + ". Archive it instead."
        )
    versions = list(sheet.versions.all())
    file_ids = list(
        LearningObjectAsset.objects.filter(version__in=versions).values_list(
            "managed_file_id", flat=True
        )
    )
    sheet.current_version = None
    sheet.published_version = None
    sheet.save(update_fields=("current_version", "published_version"))
    LearningObjectAsset.objects.filter(version__in=versions).delete()
    LearningObjectVersion.objects.filter(learning_object=sheet).delete()
    record_audit(
        actor=actor,
        action="content.sheet_deleted",
        domain="content",
        target_type="content.learning_object",
        target_id=str(sheet.id),
        reason="Permanent deletion after dependency verification.",
        source="content_management.api",
    )
    sheet.delete()
    for file_id in file_ids:
        managed_file = ManagedFile.objects.filter(id=file_id).first()
        if managed_file is None or managed_file.learning_object_assets.exists():
            continue
        storage = managed_file.blob.storage
        name = managed_file.blob.name
        managed_file.delete()
        transaction.on_commit(lambda storage=storage, name=name: storage.delete(name))

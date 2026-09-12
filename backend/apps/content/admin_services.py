from __future__ import annotations

import logging
from functools import partial
from typing import cast
from uuid import UUID

from django.db import transaction
from django.db.models import QuerySet
from django.utils.text import slugify

from apps.accounts.models import User
from apps.audit.models import AuditRecord
from apps.audit.services import record_audit
from apps.discovery.indexing import remove_search_entry
from apps.education.models import EducationNode
from apps.files.models import ManagedFile
from apps.notifications.models import Notification
from apps.notifications.services import create_notification

from .active_study import DIFFICULTIES, ActiveStudyDifficulty, ActiveStudyPlanError, plan_payload
from .active_study_questions import (
    ActiveStudyQuestionValidationResult,
    validate_active_study_questions,
)
from .active_study_readiness import readiness_payload
from .catalog_subjects import project_subject_node
from .models import (
    ActiveStudyQuestionContent,
    ActiveStudySettings,
    CatalogDocument,
    CatalogSubject,
    LearningObject,
    LearningObjectAsset,
    LearningObjectVersion,
)
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

logger = logging.getLogger("lockin.catalog")


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


def _catalog_subject_for_node(node: EducationNode) -> CatalogSubject | None:
    """Find the sole Catalog branch that owns this content location.

    EducationNode remains an implementation detail while existing versioned
    content is being retired from it.  No Catalog action resolves a subject by
    title or by a shared slug: the one-to-one mapping makes each cohort branch
    explicit.

    A subject whose cohort owns it but which has no branch yet is projected here
    rather than treated as absent.  Publishing used to be the point where that
    gap turned into a sheet nobody could open, because the branch had only ever
    been written by a migration that ran once.
    """

    subject = _subject_for_node(node)
    existing = CatalogSubject.objects.filter(source_node_id=subject.id, is_active=True).first()
    if existing is not None:
        return existing
    projected, _ = project_subject_node(subject)
    return projected if projected is not None and projected.is_active else None


def _catalog_sheet_slug(*, material_slug: str, title: str, excluding_id: UUID | None = None) -> str:
    base = slugify(title)[:110] or "sheet"
    candidate = base
    index = 2
    query = CatalogDocument.objects.filter(material_slug=material_slug)
    if excluding_id is not None:
        query = query.exclude(id=excluding_id)
    while query.filter(sheet_slug=candidate).exists():
        suffix = f"-{index}"
        candidate = f"{base[: 120 - len(suffix)]}{suffix}"
        index += 1
    return candidate


def _sync_catalog_document(sheet: LearningObject) -> bool:
    """Publish the current protected PDF at its exact Catalog address.

    Returns whether the sheet is now reachable from a student's Catalog. Content
    outside every cohort's content root stays publishable -- that is a
    deliberate capability -- but it reaches no student, and saying so is the
    point: this used to return in silence while the caller went on to announce a
    "New sheet available" that nobody could open.
    """

    version = sheet.published_version
    if version is None:
        CatalogDocument.objects.filter(version__learning_object_id=sheet.id).update(is_active=False)
        return False
    catalog_subject = _catalog_subject_for_node(version.academic_node)
    if catalog_subject is None:
        logger.warning(
            "Published sheet has no Catalog branch and stays invisible to students",
            extra={"sheet_id": str(sheet.id), "academic_node": str(version.academic_node_id)},
        )
        return False
    asset = (
        version.assets.filter(role=LearningObjectAsset.Role.PRIMARY)
        .select_related("managed_file")
        .first()
    )
    if asset is None:
        CatalogDocument.objects.filter(version__learning_object_id=sheet.id).update(is_active=False)
        return False
    document = CatalogDocument.objects.filter(version__learning_object_id=sheet.id).first()
    if document is None:
        CatalogDocument.objects.create(
            material_slug=catalog_subject.material_slug,
            sheet_slug=_catalog_sheet_slug(
                material_slug=catalog_subject.material_slug,
                title=version.title,
            ),
            version=version,
            managed_file=asset.managed_file,
            is_active=True,
        )
        return True
    document.version = version
    document.managed_file = asset.managed_file
    document.is_active = True
    document.save(update_fields=("version", "managed_file", "is_active", "updated_at"))
    return True


def is_student_visible(sheet: LearningObject) -> bool:
    """Whether a student's Catalog can actually reach this sheet.

    Content Studio lists sheets straight from ``LearningObject``, so a published
    sheet has always looked live there whether or not a Catalog branch carries
    it. This is that difference, surfaced in the interface instead of being
    discovered by a student who cannot find the sheet.
    """

    if sheet.published_version_id is None or sheet.archived_at is not None:
        return False
    return CatalogDocument.objects.filter(
        version_id=sheet.published_version_id, is_active=True
    ).exists()


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
        visible = _sync_catalog_document(sheet)
        # Announcing a sheet no student can open is worse than not announcing it.
        if notify_students and visible:
            _notify_students(actor=actor, sheet=sheet)
    _audit(actor=actor, action="content.sheet_created", sheet=sheet)
    return sheet


def _current_input(
    *,
    sheet: LearningObject,
    primary_file: ManagedFile | None,
    title: str | None = None,
    summary: str | None = None,
    position: int | None = None,
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
    asset = (
        version.assets.select_related("managed_file")
        .filter(role=LearningObjectAsset.Role.PRIMARY)
        .first()
    )
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
            position=(int(cast(int | str, changes["position"])) if "position" in changes else None),
        ),
    )
    if was_published:
        sheet = _publish_current(actor=actor, sheet=sheet)
        _sync_catalog_document(sheet)
    _audit(actor=actor, action="content.sheet_updated", sheet=sheet, previous=previous)
    return sheet


@transaction.atomic
def replace_pdf(
    *,
    actor: User,
    sheet_id: UUID,
    expected_revision: int,
    managed_file: ManagedFile,
    notify_students: bool,
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
        visible = _sync_catalog_document(sheet)
        if notify_students and visible:
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
    _sync_catalog_document(sheet)
    _audit(actor=actor, action="content.sheet_unpublished", sheet=sheet, previous=previous)
    return sheet


@transaction.atomic
def delete_pdf(*, actor: User, sheet_id: UUID, expected_revision: int) -> LearningObject:
    sheet = (
        LearningObject.objects.select_for_update(of=("self",))
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
    _sync_catalog_document(sheet)
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
        visible = _sync_catalog_document(sheet)
        if notify_students and visible:
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
        _sync_catalog_document(sheet)
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
    if sheet.active_study_question_content.exists():
        dependencies.append("Active Study question content")
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
    CatalogDocument.objects.filter(version__learning_object_id=sheet.id).delete()
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
        transaction.on_commit(partial(storage.delete, name))


def _sheets_for_subject(subject: EducationNode) -> QuerySet[LearningObject]:
    return LearningObject.objects.filter(
        current_version__content_type=LearningObjectVersion.ContentType.PDF,
        current_version__academic_node__path__startswith=subject.path,
    ).order_by("position", "current_version__title", "id")


@transaction.atomic
def reorder_sheet(
    *,
    actor: User,
    sheet_id: UUID,
    expected_revision: int,
    target_sheet_id: UUID,
    placement: str,
) -> LearningObject:
    sheet = (
        LearningObject.objects.select_for_update(of=("self",))
        .select_related("current_version__academic_node")
        .get(id=sheet_id)
    )
    target = (
        LearningObject.objects.select_for_update(of=("self",))
        .select_related("current_version__academic_node")
        .get(id=target_sheet_id)
    )
    if sheet.revision != expected_revision:
        raise ContentConflictError("This content changed. Reload it and try again.")
    if sheet.id == target.id:
        raise ContentRuleError("Choose a different sheet to reorder.")
    source_version = sheet.current_version
    target_version = target.current_version
    if source_version is None or target_version is None:
        raise ContentRuleError("A sheet without a current version cannot be reordered.")
    source_subject = _subject_for_node(source_version.academic_node)
    target_subject = _subject_for_node(target_version.academic_node)
    if source_subject.id != target_subject.id:
        raise ContentRuleError("Sheets can only be reordered within the same subject.")
    previous_position = sheet.position
    ordered = list(_sheets_for_subject(source_subject).select_for_update())
    ordered = [item for item in ordered if item.id != sheet.id]
    target_index = next(index for index, item in enumerate(ordered) if item.id == target.id)
    ordered.insert(target_index + (1 if placement == "after" else 0), sheet)
    for position, item in enumerate(ordered):
        if item.position != position:
            item.position = position
            item.save(update_fields=("position", "updated_at"))
    sheet.refresh_from_db()
    _audit(
        actor=actor,
        action="content.sheet_reordered",
        sheet=sheet,
        previous={"position": previous_position},
    )
    return sheet


def active_study_payload(*, sheet: LearningObject) -> dict[str, object]:
    readiness = readiness_payload(sheet=sheet)
    settings = getattr(sheet, "active_study_settings", None)
    content_by_difficulty = {
        content.difficulty: content
        for content in ActiveStudyQuestionContent.objects.filter(sheet=sheet)
    }
    difficulties = cast(list[dict[str, object]], readiness["difficulties"])
    for difficulty_plan in difficulties:
        key = str(difficulty_plan["difficulty"])
        content = content_by_difficulty.get(key)
        expected_checkpoint = cast(int, difficulty_plan["number_of_parts"]) * cast(
            int, difficulty_plan["questions_per_checkpoint"]
        )
        expected_final = cast(int, difficulty_plan["final_exam_questions"])
        status = cast(dict[str, str], difficulty_plan["readiness"])["status"]
        difficulty_plan["content"] = {
            "status": status,
            "checkpoint_question_count": (
                content.checkpoint_question_count if content is not None else 0
            ),
            "checkpoint_question_target": expected_checkpoint,
            "final_exam_question_count": (
                content.final_exam_question_count if content is not None else 0
            ),
            "final_exam_question_target": expected_final,
            "revision": content.revision if content is not None else 0,
        }
    has_existing_questions = (
        sheet.question_versions.exists()
        or sheet.question_import_batches.exists()
        or bool(content_by_difficulty)
    )
    return {
        "enabled": settings.enabled if settings is not None else False,
        "revision": settings.revision if settings is not None else 0,
        "excluded_start_pages": readiness["excluded_start_pages"],
        "excluded_end_pages": readiness["excluded_end_pages"],
        "existing_question_content": has_existing_questions,
        "question_configuration_status": (
            "configured"
            if any(
                cast(dict[str, object], item["content"])["status"] == "ready"
                for item in difficulties
            )
            else "not_configured"
        ),
        **{**readiness, "difficulties": difficulties},
    }


def _plan_signature(difficulty_plan: dict[str, object]) -> dict[str, object]:
    return {
        "number_of_parts": difficulty_plan["number_of_parts"],
        "page_ranges": difficulty_plan["page_ranges"],
    }


def _difficulty_for_key(key: str) -> ActiveStudyDifficulty:
    for difficulty in DIFFICULTIES:
        if difficulty.key == key:
            return difficulty
    raise ContentRuleError("Active Study difficulty must be easy, medium, or hard.")


def _difficulty_plan_for_sheet(
    *, sheet: LearningObject, difficulty_key: str
) -> tuple[ActiveStudyDifficulty, dict[str, object]]:
    settings = ActiveStudySettings.objects.filter(sheet=sheet).first()
    total_pages = settings.total_pdf_pages if settings is not None else None
    if settings is None or total_pages is None:
        raise ContentRuleError(
            "Configure the Active Study PDF page count before importing questions."
        )
    try:
        plan = plan_payload(
            total_pdf_pages=total_pages,
            excluded_start_pages=settings.excluded_start_pages,
            excluded_end_pages=settings.excluded_end_pages,
        )
    except ActiveStudyPlanError as error:
        raise ContentRuleError(str(error)) from error
    difficulty = _difficulty_for_key(difficulty_key)
    difficulty_plan = next(
        item
        for item in cast(list[dict[str, object]], plan["difficulties"])
        if item["difficulty"] == difficulty.key
    )
    return difficulty, difficulty_plan


def validate_active_study_question_content(
    *, sheet: LearningObject, difficulty_key: str, payload: object
) -> ActiveStudyQuestionValidationResult:
    difficulty, difficulty_plan = _difficulty_plan_for_sheet(
        sheet=sheet, difficulty_key=difficulty_key
    )
    return validate_active_study_questions(
        payload,
        difficulty=difficulty,
        number_of_parts=cast(int, difficulty_plan["number_of_parts"]),
    )


def active_study_question_content_payload(
    *, sheet: LearningObject, difficulty_key: str
) -> dict[str, object]:
    difficulty, difficulty_plan = _difficulty_plan_for_sheet(
        sheet=sheet, difficulty_key=difficulty_key
    )
    content = ActiveStudyQuestionContent.objects.filter(
        sheet=sheet, difficulty=difficulty.key
    ).first()
    readiness = next(
        item
        for item in cast(list[dict[str, object]], readiness_payload(sheet=sheet)["difficulties"])
        if item["difficulty"] == difficulty.key
    )
    readiness_detail = cast(dict[str, object], readiness["readiness"])
    status = cast(str, readiness_detail["status"])
    return {
        "difficulty": difficulty.key,
        "number_of_parts": difficulty_plan["number_of_parts"],
        "page_ranges": difficulty_plan["page_ranges"],
        "content": {
            "status": status,
            "revision": content.revision if content is not None else 0,
            "checkpoint_question_count": (
                content.checkpoint_question_count if content is not None else 0
            ),
            "checkpoint_question_target": cast(int, difficulty_plan["number_of_parts"])
            * difficulty.questions_per_checkpoint,
            "final_exam_question_count": (
                content.final_exam_question_count if content is not None else 0
            ),
            "final_exam_question_target": difficulty.final_exam_questions,
            "payload": content.payload if content is not None else None,
            "readiness": readiness_detail,
        },
    }


@transaction.atomic
def save_active_study_question_content(
    *,
    actor: User,
    sheet_id: UUID,
    difficulty_key: str,
    payload: object,
    expected_revision: int,
) -> ActiveStudyQuestionContent:
    sheet = LearningObject.objects.select_for_update().get(id=sheet_id)
    validation = validate_active_study_question_content(
        sheet=sheet, difficulty_key=difficulty_key, payload=payload
    )
    _, difficulty_plan = _difficulty_plan_for_sheet(sheet=sheet, difficulty_key=difficulty_key)
    content = (
        ActiveStudyQuestionContent.objects.select_for_update()
        .filter(sheet=sheet, difficulty=difficulty_key)
        .first()
    )
    if content is None:
        if expected_revision != 0:
            raise ContentConflictError("This Active Study content changed. Reload and try again.")
        content = ActiveStudyQuestionContent.objects.create(
            sheet=sheet,
            difficulty=difficulty_key,
            payload=validation.payload,
            plan_signature=_plan_signature(difficulty_plan),
            checkpoint_question_count=validation.checkpoint_question_count,
            final_exam_question_count=validation.final_exam_question_count,
            revision=1,
            created_by=actor,
            updated_by=actor,
        )
        action = "content.active_study_questions_imported"
    else:
        if content.revision != expected_revision:
            raise ContentConflictError("This Active Study content changed. Reload and try again.")
        content.payload = validation.payload
        content.plan_signature = _plan_signature(difficulty_plan)
        content.checkpoint_question_count = validation.checkpoint_question_count
        content.final_exam_question_count = validation.final_exam_question_count
        content.updated_by = actor
        content.revision += 1
        content.save(
            update_fields=(
                "payload",
                "plan_signature",
                "checkpoint_question_count",
                "final_exam_question_count",
                "updated_by",
                "revision",
                "updated_at",
            )
        )
        action = "content.active_study_questions_replaced"
    record_audit(
        actor=actor,
        action=action,
        domain="content",
        target_type="content.learning_object",
        target_id=str(sheet.id),
        reason="Active Study questions saved.",
        source="content_management.api",
        metadata={
            "difficulty": difficulty_key,
            "checkpoint_question_count": validation.checkpoint_question_count,
            "final_exam_question_count": validation.final_exam_question_count,
        },
    )
    return content


@transaction.atomic
def delete_active_study_question_content(
    *, actor: User, sheet_id: UUID, difficulty_key: str, expected_revision: int
) -> None:
    sheet = LearningObject.objects.select_for_update().get(id=sheet_id)
    _difficulty_for_key(difficulty_key)
    content = ActiveStudyQuestionContent.objects.select_for_update().get(
        sheet=sheet, difficulty=difficulty_key
    )
    if content.revision != expected_revision:
        raise ContentConflictError("This Active Study content changed. Reload and try again.")
    checkpoint_question_count = content.checkpoint_question_count
    final_exam_question_count = content.final_exam_question_count
    content.delete()
    record_audit(
        actor=actor,
        action="content.active_study_questions_deleted",
        domain="content",
        target_type="content.learning_object",
        target_id=str(sheet.id),
        reason="Active Study questions deleted.",
        source="content_management.api",
        metadata={
            "difficulty": difficulty_key,
            "checkpoint_question_count": checkpoint_question_count,
            "final_exam_question_count": final_exam_question_count,
        },
    )


@transaction.atomic
def update_active_study_settings(
    *,
    actor: User,
    sheet_id: UUID,
    expected_revision: int,
    enabled: bool,
    total_pdf_pages: int | None,
    excluded_start_pages: int,
    excluded_end_pages: int,
    confirm_boundary_change: bool,
) -> LearningObject:
    sheet = LearningObject.objects.select_for_update().get(id=sheet_id)
    settings, created = ActiveStudySettings.objects.select_for_update().get_or_create(sheet=sheet)
    if not created and settings.revision != expected_revision:
        raise ContentConflictError("These Active Study settings changed. Reload and try again.")
    if created and expected_revision != 0:
        raise ContentConflictError("These Active Study settings changed. Reload and try again.")
    if created:
        settings.revision = 0
    resolved_total = total_pdf_pages if total_pdf_pages is not None else settings.total_pdf_pages
    if enabled and resolved_total is None:
        raise ContentRuleError("Enter the PDF's total page count before enabling Active Study.")
    if enabled:
        version = sheet.current_version
        has_pdf = (
            version is not None
            and LearningObjectAsset.objects.filter(
                version=version,
                role=LearningObjectAsset.Role.PRIMARY,
                managed_file__content_type="application/pdf",
            ).exists()
        )
        if not has_pdf:
            raise ContentRuleError("Upload a valid PDF before enabling Active Study.")
    if resolved_total is not None:
        try:
            plan_payload(
                total_pdf_pages=resolved_total,
                excluded_start_pages=excluded_start_pages,
                excluded_end_pages=excluded_end_pages,
            )
        except ActiveStudyPlanError as error:
            raise ContentRuleError(str(error)) from error
    boundaries_changed = (
        settings.total_pdf_pages != resolved_total
        or settings.excluded_start_pages != excluded_start_pages
        or settings.excluded_end_pages != excluded_end_pages
    )
    has_existing_questions = (
        sheet.question_versions.exists() or sheet.question_import_batches.exists()
    )
    if boundaries_changed and has_existing_questions and not confirm_boundary_change:
        raise ContentRuleError(
            "Changing excluded pages changes Active Study part boundaries. Existing question "
            "configuration may no longer match this sheet; confirm before saving."
        )
    previous = active_study_payload(sheet=sheet)
    settings.enabled = enabled
    settings.total_pdf_pages = resolved_total
    settings.excluded_start_pages = excluded_start_pages
    settings.excluded_end_pages = excluded_end_pages
    settings.revision += 1
    settings.save(
        update_fields=(
            "enabled",
            "total_pdf_pages",
            "excluded_start_pages",
            "excluded_end_pages",
            "revision",
            "updated_at",
        )
    )
    record_audit(
        actor=actor,
        action="content.active_study_updated",
        domain="content",
        target_type="content.learning_object",
        target_id=str(sheet.id),
        reason="Active Study settings updated.",
        source="content_management.api",
        previous_state=previous,
        new_state=active_study_payload(sheet=sheet),
    )
    return sheet

"""Start Rescue domain logic. No progress, checkpoint, XP or duration adaptation."""

import hashlib
import json
from typing import Any, cast
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from apps.accounts.models import User
from apps.content.models import CatalogDocument, CatalogWorkspaceSnapshot
from apps.content.selectors import published_learning_objects
from apps.content.views import _catalog_document_by_id

from .managed_active_study import run_payload
from .models import ActiveStudyRun, FocusSession
from .rescue_models import RescueMutationReceipt, RescueSession

TERMINAL = {"stopped", "continued", "finished"}
# Explain is scheduled for a later release, so Rescue does not offer it yet.
RESCUE_EXPLAIN_ENABLED = False
SOURCE_FIELDS = (
    "catalog_document_id",
    "learning_object_version_id",
    "managed_file_id",
    "edition",
    "task_type",
    "page_start",
    "page_end",
)


class RescueConflict(APIException):
    status_code = 409
    default_code = "rescue_conflict"
    default_detail = "This start changed elsewhere. Your device copy has been kept."


def require_enabled() -> None:
    if not settings.START_RESCUE_ENABLED:
        raise PermissionDenied("Start Rescue is not enabled.")


def permitted_document(user: User, document_id: UUID) -> CatalogDocument:
    # Reuse the exact reader publication/cohort/file/entitlement policy, as Study Tools do.
    return _catalog_document_by_id(user=user, document_id=document_id)


def page_limit(user: User, document: CatalogDocument) -> int:
    count = document.managed_file.pdf_page_count
    if not count:
        raise ValidationError("The PDF page count is unavailable.")
    runs = ActiveStudyRun.objects.filter(
        user=user,
        sheet_id=document.version.learning_object_id,
        edition=document.edition,
        status="active",
    )
    limits = [
        payload["current_page_range"]["end_page"]
        for run in runs
        if (payload := run_payload(run)) and payload["current_page_range"]
    ]
    return cast(int, min([count, *limits]))


def source_payload(document: CatalogDocument, page: int) -> dict[str, Any]:
    return {
        "catalog_document_id": str(document.id),
        "learning_object_version_id": str(document.version_id),
        "managed_file_id": str(document.managed_file_id),
        "edition": document.edition,
        "page_start": page,
        "page_end": page,
        "title": document.version.title,
        "path": (
            f"/materials/catalog/{document.material_slug}/sheets/{document.sheet_slug}/workspace"
        ),
    }


def suggestions(user: User, document_id: UUID | None, page: int | None) -> list[dict[str, Any]]:
    require_enabled()
    document: CatalogDocument | None
    if document_id:
        document = permitted_document(user, document_id)
    else:
        # Current reader history precedes a bounded deterministic catalog fallback.
        # Unlinked study-plan text is not a source identity.
        ids = list(
            CatalogWorkspaceSnapshot.objects.filter(user=user)
            .order_by("-updated_at")
            .values_list("document_id", flat=True)[:12]
        )
        fallback = CatalogDocument.objects.filter(
            is_active=True, version__learning_object__in=published_learning_objects()
        ).order_by("version__learning_object__position", "material_slug", "sheet_slug")
        ids.extend(
            identifier
            for identifier in fallback.values_list("id", flat=True)[:24]
            if identifier not in ids
        )
        document = None
        for identifier in ids:
            try:
                document = permitted_document(user, identifier)
                break
            except (PermissionDenied, NotFound):
                continue
    if document is None:
        return []
    limit = page_limit(user, document)
    if page is None:
        snapshot = CatalogWorkspaceSnapshot.objects.filter(user=user, document=document).first()
        try:
            page = int((snapshot.state.get("view") or {}).get("page", 1)) if snapshot else 1
        except (TypeError, ValueError, OverflowError):
            page = 1
        page = min(limit, max(1, page))
    if page > limit:
        raise PermissionDenied("This source page is not currently accessible.")
    source = source_payload(document, page)
    activities = [{"task_type": "read", **source}]
    if settings.KNOWLEDGE_ENABLED:
        from apps.knowledge.models import ExplainQuestion
        from apps.knowledge.services import sources_for, tool_flags

        flags = tool_flags(document)
        if flags["summary"]:
            activities.append({"task_type": "summary", **source})
        question = (
            ExplainQuestion.objects.filter(
                published=True,
                source__in=sources_for(document),
                source__page_start__lte=page,
                source__page_end__gte=page,
                source__page_end__lte=limit,
            )
            .select_related("source")
            .order_by("id")
            .first()
            if RESCUE_EXPLAIN_ENABLED and flags["explain"]
            else None
        )
        if question:
            activities.append(
                {
                    "task_type": "explain",
                    **source,
                    "question_id": str(question.id),
                    "page_start": question.source.page_start,
                    "page_end": question.source.page_end,
                }
            )
    return activities


def session_payload(item: RescueSession) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "account_id": str(item.account_id),
        "catalog_document_id": str(item.catalog_document_id),
        "learning_object_version_id": str(item.learning_object_version_id),
        "managed_file_id": str(item.managed_file_id),
        "edition": item.edition,
        "task_type": item.task_type,
        "page_start": item.page_start,
        "page_end": item.page_end,
        "started_at": item.started_at.isoformat() if item.started_at else None,
        "ended_at": item.ended_at.isoformat() if item.ended_at else None,
        "active_duration_seconds": item.active_duration_seconds,
        "status": item.status,
        "exit_reason": item.exit_reason,
        "continued_into_study_session_id": str(item.continued_into_study_session_id)
        if item.continued_into_study_session_id
        else None,
        "device_mutation_id": str(item.device_mutation_id),
        "sync_revision": item.sync_revision,
    }


@transaction.atomic
def save_session(user: User, identifier: UUID, data: dict[str, Any]) -> dict[str, Any]:
    require_enabled()
    if data["account_id"] != user.id:
        raise PermissionDenied("This start belongs to another account.")
    # Serialize first creates, cross-device starts, and receipt replay on an existing row.
    User.objects.select_for_update().get(pk=user.pk)
    digest = hashlib.sha256(
        json.dumps({"id": str(identifier), **data}, sort_keys=True, default=str).encode()
    ).hexdigest()
    receipt = RescueMutationReceipt.objects.filter(
        account=user, mutation_id=data["device_mutation_id"]
    ).first()
    if receipt:
        if receipt.digest != digest:
            raise RescueConflict("This mutation identifier already describes different activity.")
        return cast(dict[str, Any], receipt.response)
    item = RescueSession.objects.filter(pk=identifier).first()
    if item and item.account_id != user.id:
        raise NotFound()
    if data["expected_revision"] != (item.sync_revision if item else 0):
        raise RescueConflict()
    if item:
        if any(str(getattr(item, field)) != str(data[field]) for field in SOURCE_FIELDS):
            raise RescueConflict("The source and activity of a start cannot be changed.")
        if item.status in TERMINAL:
            raise RescueConflict("This start has ended.")
        if (
            data["active_duration_seconds"] < item.active_duration_seconds
            or item.started_at
            and item.started_at != data["started_at"]
        ):
            raise RescueConflict("Recorded activity cannot be rewritten.")
    if not item or data["status"] == "active":
        document = permitted_document(user, data["catalog_document_id"])
        if (
            document.version_id != data["learning_object_version_id"]
            or document.managed_file_id != data["managed_file_id"]
            or document.edition != data["edition"]
        ):
            raise RescueConflict("The PDF changed. Choose an activity from the current source.")
        if data["page_end"] > page_limit(user, document):
            raise PermissionDenied("This source page is not currently accessible.")
        if data["task_type"] not in {
            activity["task_type"] for activity in suggestions(user, document.id, data["page_start"])
        }:
            raise PermissionDenied("This activity is not available for the source.")
    if data["status"] in {"active", "paused"}:
        if (
            RescueSession.objects.filter(account=user, status__in=["active", "paused"])
            .exclude(pk=identifier)
            .exists()
        ):
            raise RescueConflict("Another short start is already open.")
        if FocusSession.objects.filter(
            user=user, status__in=["active", "paused", "on_break"]
        ).exists():
            raise RescueConflict("Continue the study session that is already open.")
    start, end = data["started_at"], data["ended_at"]
    if (
        start
        and start.timestamp() > timezone.now().timestamp() + 300
        or end
        and end.timestamp() > timezone.now().timestamp() + 300
    ):
        raise ValidationError("Activity timestamps are in the future.")
    if start and end and data["active_duration_seconds"] > (end - start).total_seconds() + 2:
        raise ValidationError("Active duration exceeds the recorded interval.")
    item = item or RescueSession(id=identifier, account=user)
    for field, value in data.items():
        if field not in {"account_id", "expected_revision"}:
            setattr(item, field, value)
    item.sync_revision += 1
    item.save()
    response = session_payload(item)
    RescueMutationReceipt.objects.create(
        account=user, mutation_id=data["device_mutation_id"], digest=digest, response=response
    )
    return response

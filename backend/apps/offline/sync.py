"""Batch replay for work a device did while offline.

One receipt per account and client operation ID makes every operation type
idempotent: a retried batch returns the stored result instead of applying the
work again. Client scores, stages, timestamps and rewards are never read; each
handler calls the same domain service the online endpoint uses.
"""

import hashlib
import json
import logging
from collections.abc import Callable
from typing import NamedTuple
from uuid import UUID

from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, ValidationError

from apps.accounts.models import User
from apps.content.editions import UnknownEditionError
from apps.content.views import _owned_question_sheet, _sheet_questions
from apps.focus.managed_active_study import (
    ManagedActiveStudyRuleError,
    OfflineReplayOutOfOrder,
    replay_offline_attempt,
    replay_offline_continue,
    replay_offline_restart,
)
from apps.questions.answering import AnswerRejected, answer_question
from apps.xp.models import XpBalance

from .models import OfflineOperationReceipt
from .review import replay_review_answer

logger = logging.getLogger("lockin.offline")

MAX_BATCH = 100


def _uuid(value: object, field: str) -> UUID:
    try:
        return UUID(str(value))
    except (ValueError, AttributeError) as error:
        raise ValidationError({field: ["A valid UUID is required."]}) from error


def _question_answer(user: User, payload: dict[str, object]) -> dict[str, object]:
    sheet_id = _uuid(payload.get("sheet_id"), "sheet_id")
    question_id = _uuid(payload.get("question_id"), "question_id")
    raw_choices = payload.get("choice_ids")
    if not isinstance(raw_choices, list) or not raw_choices or len(raw_choices) > 20:
        raise ValidationError({"choice_ids": ["Choose one or more answers."]})
    choice_ids = [_uuid(choice, "choice_ids") for choice in raw_choices]
    sheet, _ = _owned_question_sheet(user, sheet_id)
    question = get_object_or_404(_sheet_questions(sheet), id=question_id)
    try:
        answer, created = answer_question(user=user, question=question, choice_ids=choice_ids)
    except AnswerRejected as error:
        raise ValidationError({"choice_ids": [str(error)]}) from error
    return {
        "question_id": str(question_id),
        "created": created,
        "is_correct": answer.is_correct,
        "xp_awarded": answer.xp_awarded,
        "selected_choice_ids": answer.selected_option_ids,
    }


class _ActiveStudyScope(NamedTuple):
    sheet_id: UUID
    edition: str
    difficulty: str


def _active_study_scope(payload: dict[str, object]) -> _ActiveStudyScope:
    return _ActiveStudyScope(
        sheet_id=_uuid(payload.get("sheet_id"), "sheet_id"),
        edition=str(payload.get("edition") or ""),
        difficulty=str(payload.get("difficulty") or ""),
    )


def _active_study_attempt(user: User, payload: dict[str, object]) -> dict[str, object]:
    scope = _active_study_scope(payload)
    part = payload.get("part")
    return replay_offline_attempt(
        user=user,
        sheet_id=scope.sheet_id,
        edition=scope.edition,
        difficulty=scope.difficulty,
        kind=str(payload.get("kind") or ""),
        part=part if isinstance(part, int) else None,
        attempt_id=_uuid(payload.get("attempt_id"), "attempt_id"),
        answers=payload.get("answers"),
    )


def _active_study_continue(user: User, payload: dict[str, object]) -> dict[str, object]:
    scope = _active_study_scope(payload)
    part = payload.get("part")
    if not isinstance(part, int) or isinstance(part, bool) or part < 1:
        raise ValidationError({"part": ["Part is invalid."]})
    return replay_offline_continue(
        user=user,
        sheet_id=scope.sheet_id,
        edition=scope.edition,
        difficulty=scope.difficulty,
        part=part,
    )


def _active_study_restart(user: User, payload: dict[str, object]) -> dict[str, object]:
    scope = _active_study_scope(payload)
    return replay_offline_restart(
        user=user, sheet_id=scope.sheet_id, edition=scope.edition, difficulty=scope.difficulty
    )


def _review_answer(user: User, payload: dict[str, object]) -> dict[str, object]:
    return replay_review_answer(user=user, payload=payload)


def _handler(kind: object) -> Callable[[User, dict[str, object]], dict[str, object]] | None:
    # Resolved per call so each handler stays an ordinary module function.
    return {
        "question_answer": _question_answer,
        "active_study_attempt": _active_study_attempt,
        "active_study_continue": _active_study_continue,
        "active_study_restart": _active_study_restart,
        "review_answer": _review_answer,
    }.get(str(kind))


def replay_batch(*, user: User, operations: list[object]) -> dict[str, object]:
    if len(operations) > MAX_BATCH:
        raise ValidationError(
            {"operations": [f"At most {MAX_BATCH} operations are allowed per batch."]}
        )
    accepted: list[dict[str, object]] = []
    rejected: list[dict[str, object]] = []

    def reject(operation_id: object, *, code: str, reason: str, retryable: bool = False) -> None:
        # `retryable` separates a business-rule refusal, which will never
        # succeed, from a temporary one the device should try again.
        logger.info(
            "Offline sync operation rejected", extra={"user_id": str(user.pk), "reason": code}
        )
        rejected.append(
            {
                "operation_id": str(operation_id) if operation_id else None,
                "code": code,
                "reason": reason,
                "retryable": retryable,
            }
        )

    for raw in operations:
        if not isinstance(raw, dict):
            reject(None, code="invalid", reason="invalid_operation")
            continue
        operation_id = raw.get("operation_id")
        try:
            key = _uuid(operation_id, "operation_id")
            kind = raw.get("operation_type")
            payload = raw.get("payload")
            handler = _handler(kind)
            if handler is None or not isinstance(payload, dict):
                raise ValidationError("Unsupported offline operation.")
            # Only the operation type and payload are evidence. Hash them to
            # reject an ID replayed with new claims.
            evidence = {"operation_type": kind, "payload": payload}
            digest = hashlib.sha256(
                json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            with transaction.atomic():
                User.objects.select_for_update().get(pk=user.pk)
                receipt = OfflineOperationReceipt.objects.filter(
                    user=user, operation_id=key
                ).first()
                if receipt is not None:
                    if receipt.request_digest != digest:
                        raise ValidationError("Operation ID was reused with different data.")
                    logger.info("Offline sync duplicate", extra={"user_id": str(user.pk)})
                    result = receipt.response_payload
                else:
                    result = handler(user, payload)
                    OfflineOperationReceipt.objects.create(
                        user=user,
                        operation_id=key,
                        request_digest=digest,
                        response_payload=json.loads(json.dumps(result, default=str)),
                    )
            accepted.append({"operation_id": str(key), "result": result})
        except OfflineReplayOutOfOrder as error:
            reject(operation_id, code="out_of_order", reason=str(error))
        except (ManagedActiveStudyRuleError, UnknownEditionError) as error:
            reject(operation_id, code="rejected", reason=str(error))
        except (ValidationError, Http404) as error:
            reject(
                operation_id,
                code="rejected",
                reason=str(getattr(error, "detail", "Content unavailable.")),
            )
        except APIException as error:
            # Throttling or a temporarily unavailable dependency: the device
            # keeps the operation and tries again later.
            retryable = int(getattr(error, "status_code", 500)) in {429, 503}
            reject(
                operation_id,
                code="unavailable" if retryable else "rejected",
                reason=str(error.detail),
                retryable=retryable,
            )
    balance = XpBalance.objects.filter(user=user).first()
    logger.info(
        "Offline sync batch",
        extra={"user_id": str(user.pk), "accepted": len(accepted), "rejected": len(rejected)},
    )
    return {
        "accepted": accepted,
        "rejected": rejected,
        "xp_total": balance.total_points if balance else 0,
    }

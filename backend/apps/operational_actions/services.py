import hashlib
import hmac
from datetime import timedelta
from typing import Any
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac

from apps.accounts.models import User
from apps.accounts.services import AccountStateError, set_account_status
from apps.administration.catalog import Capability
from apps.administration.permissions import has_operational_capability
from apps.administration.services import (
    is_final_effective_platform_administrator,
    lock_effective_platform_administrators,
)
from apps.audit.services import record_audit
from apps.system_configuration.services import get_configuration_value

from .models import OperationalActionRun


class OperationalActionError(ValueError):
    pass


ACTION_CODE = "users.set_status"


def _confirmation_token(run_id: UUID) -> str:
    return salted_hmac(
        "lockin.operational-actions.confirmation",
        str(run_id),
        secret=settings.SECRET_KEY,
        algorithm="sha256",
    ).hexdigest()


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _validated_payload(*, actor: User, payload: Any) -> tuple[list[UUID], str]:
    if not isinstance(payload, dict):
        raise OperationalActionError("The operational action payload must be an object.")
    raw_ids = payload.get("user_ids")
    to_status = str(payload.get("status", ""))
    if not isinstance(raw_ids, list) or not raw_ids:
        raise OperationalActionError("At least one user must be selected.")
    maximum = int(get_configuration_value("operations.max_action_targets"))
    if len(raw_ids) > maximum:
        raise OperationalActionError(f"A single action can target at most {maximum} users.")
    try:
        user_ids = [UUID(str(value)) for value in raw_ids]
    except ValueError as error:
        raise OperationalActionError("One or more user identifiers are invalid.") from error
    if len(user_ids) != len(set(user_ids)):
        raise OperationalActionError("Action targets cannot be duplicated.")
    if to_status not in {User.Status.ACTIVE, User.Status.SUSPENDED}:
        raise OperationalActionError("The requested account status is not supported.")
    if to_status == User.Status.SUSPENDED and actor.id in user_ids:
        raise OperationalActionError("Operators cannot suspend their own account.")
    return user_ids, to_status


@transaction.atomic
def preview_action(
    *,
    actor: User,
    action_code: str,
    payload: dict[str, Any],
    reason: str,
    idempotency_key: str,
) -> tuple[OperationalActionRun, str]:
    if action_code != ACTION_CODE:
        raise OperationalActionError("Unknown operational action.")
    if not has_operational_capability(actor, Capability.USERS_MANAGE):
        raise OperationalActionError("User management permission is required.")
    reason = reason.strip()
    if len(reason) < 8:
        raise OperationalActionError("A reason of at least 8 characters is required.")
    user_ids, to_status = _validated_payload(actor=actor, payload=payload)
    users = list(User.objects.filter(id__in=user_ids).order_by("id"))
    if len(users) != len(user_ids):
        raise OperationalActionError("One or more target users were not found.")
    if to_status == User.Status.SUSPENDED and any(
        is_final_effective_platform_administrator(user=user) for user in users
    ):
        raise OperationalActionError("The final active platform administrator cannot be suspended.")
    normalized_payload = {"user_ids": [str(value) for value in user_ids], "status": to_status}
    preview = {
        "target_count": len(users),
        "changes": [
            {
                "user_id": str(user.id),
                "full_name": user.full_name,
                "from_status": user.status,
                "to_status": to_status,
                "will_change": user.status != to_status,
            }
            for user in users
        ],
    }
    expires_at = timezone.now() + timedelta(
        seconds=int(get_configuration_value("operations.preview_ttl_seconds"))
    )
    run, created = OperationalActionRun.objects.get_or_create(
        requested_by=actor,
        idempotency_key=idempotency_key,
        defaults={
            "action_code": action_code,
            "reason": reason,
            "payload": normalized_payload,
            "preview": preview,
            "confirmation_digest": "",
            "expires_at": expires_at,
        },
    )
    if not created:
        if (
            run.action_code != action_code
            or run.payload != normalized_payload
            or run.reason != reason
        ):
            raise OperationalActionError("The idempotency key was already used for another action.")
        return run, _confirmation_token(run.id)
    token = _confirmation_token(run.id)
    run.confirmation_digest = _digest(token)
    run.save(update_fields=("confirmation_digest",))
    return run, token


@transaction.atomic
def execute_action(
    *, run_id: str, confirmation_token: str, actor: User, source: str
) -> OperationalActionRun:
    try:
        run = OperationalActionRun.objects.select_for_update().get(id=run_id, requested_by=actor)
    except (OperationalActionRun.DoesNotExist, ValueError) as error:
        raise OperationalActionError("Operational action preview was not found.") from error
    if run.status in {OperationalActionRun.Status.COMPLETED, OperationalActionRun.Status.PARTIAL}:
        return run
    if run.status != OperationalActionRun.Status.PREVIEWED:
        raise OperationalActionError("Operational action is not confirmable.")
    if run.expires_at <= timezone.now():
        run.status = OperationalActionRun.Status.EXPIRED
        run.save(update_fields=("status",))
        raise OperationalActionError("Operational action preview has expired.")
    if not hmac.compare_digest(run.confirmation_digest, _digest(confirmation_token)):
        raise OperationalActionError("Operational action confirmation is invalid.")
    if not has_operational_capability(actor, Capability.USERS_MANAGE):
        raise OperationalActionError("Permission changed before action confirmation.")
    user_ids, to_status = _validated_payload(actor=actor, payload=run.payload)
    if to_status == User.Status.SUSPENDED:
        lock_effective_platform_administrators()
        targets = User.objects.filter(id__in=user_ids)
        if any(is_final_effective_platform_administrator(user=user) for user in targets):
            raise OperationalActionError(
                "The final active platform administrator cannot be suspended."
            )
    run.status = OperationalActionRun.Status.EXECUTING
    run.save(update_fields=("status",))
    successes: list[str] = []
    failures: list[dict[str, str]] = []
    for user_id in user_ids:
        try:
            target = User.objects.get(id=user_id)
            previous = target.status
            target = set_account_status(
                target=target, actor=actor, status=to_status, reason=run.reason
            )
            successes.append(str(user_id))
            if previous != target.status:
                record_audit(
                    actor=actor,
                    action="operational_actions.user_status.changed",
                    domain="operational_actions",
                    target_type="accounts.user",
                    target_id=str(user_id),
                    reason=run.reason,
                    source=source,
                    previous_state={"status": previous},
                    new_state={"status": target.status},
                    related_entities=[{"type": "operational_actions.run", "id": str(run.id)}],
                )
        except (User.DoesNotExist, AccountStateError) as error:
            failures.append({"user_id": str(user_id), "error": str(error)})
    if successes and failures:
        run.status = OperationalActionRun.Status.PARTIAL
    elif successes:
        run.status = OperationalActionRun.Status.COMPLETED
    else:
        run.status = OperationalActionRun.Status.FAILED
    run.result_summary = {
        "requested": len(user_ids),
        "succeeded": len(successes),
        "failed": len(failures),
        "successful_user_ids": successes,
        "failures": failures,
    }
    run.completed_at = timezone.now()
    run.save(update_fields=("status", "result_summary", "completed_at"))
    record_audit(
        actor=actor,
        action="operational_actions.run.completed",
        domain="operational_actions",
        target_type="operational_actions.run",
        target_id=str(run.id),
        reason=run.reason,
        source=source,
        new_state={"status": run.status, **run.result_summary},
    )
    return run

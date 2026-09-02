from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.accounts.models import User
from apps.subscriptions.models import Subscription
from platform_core.events import publish_after_commit

from .events import EntitlementGranted, EntitlementRevoked
from .models import (
    EntitlementDefinition,
    EntitlementGrant,
    EntitlementGrantAudit,
    PlanEntitlementRule,
)
from .validation import validate_entitlement_code


@dataclass(frozen=True, slots=True)
class EntitlementDecision:
    code: str
    allowed: bool
    reason: str
    expires_at: datetime | None = None
    quantity_limit: int | None = None
    configuration: dict[str, object] | None = None


def _snapshot(grant: EntitlementGrant) -> dict[str, object]:
    return {
        "status": grant.status,
        "starts_at": grant.starts_at.isoformat(),
        "ends_at": grant.ends_at.isoformat() if grant.ends_at else None,
        "quantity_limit": grant.quantity_limit,
        "configuration": grant.configuration,
        "revision": grant.revision,
    }


@transaction.atomic
def sync_subscription_entitlements(*, subscription_id: UUID) -> list[EntitlementGrant]:
    subscription = (
        Subscription.objects.select_for_update()
        .select_related("account__primary_user", "plan_version")
        .get(id=subscription_id)
    )
    user = subscription.account.primary_user
    if user is None:
        return []
    allowed = subscription.status in (
        Subscription.Status.TRIALING,
        Subscription.Status.ACTIVE,
        Subscription.Status.GRACE,
    )
    subscription_start = (
        subscription.current_period_started_at
        or subscription.trial_started_at
        or subscription.started_at
        or subscription.created_at
    )
    # A paid segment may begin after a still-active trial. Entitlement access
    # remains continuous from the original subscription start while accounting
    # stays anchored to the paid segment.
    start = min(
        value
        for value in (
            subscription_start,
            subscription.trial_started_at,
            subscription.started_at,
        )
        if value is not None
    )
    if subscription.status == Subscription.Status.TRIALING:
        end = subscription.trial_ends_at
    elif subscription.status == Subscription.Status.GRACE:
        end = subscription.grace_ends_at
    else:
        end = subscription.grace_ends_at or subscription.current_period_ends_at
    existing = list(
        EntitlementGrant.objects.select_for_update().filter(
            user=user,
            source_type=EntitlementGrant.SourceType.SUBSCRIPTION,
            source_id=subscription.id,
        )
    )
    if not allowed:
        for existing_grant in existing:
            if existing_grant.status == EntitlementGrant.Status.ACTIVE:
                _revoke_locked(
                    grant=existing_grant,
                    reason_code=f"subscription_{subscription.status}",
                )
        return existing
    rules = PlanEntitlementRule.objects.select_related("entitlement").filter(
        plan_version=subscription.plan_version,
        entitlement__is_active=True,
    )
    grants_by_entitlement = {grant.entitlement_id: grant for grant in existing}
    active_ids: set[UUID] = set()
    for rule in rules:
        active_ids.add(rule.entitlement_id)
        grant = grants_by_entitlement.get(rule.entitlement_id)
        created = grant is None
        if grant is None:
            grant = EntitlementGrant.objects.create(
                user=user,
                entitlement=rule.entitlement,
                source_type=EntitlementGrant.SourceType.SUBSCRIPTION,
                source_id=subscription.id,
                status=EntitlementGrant.Status.ACTIVE,
                starts_at=start,
                ends_at=end,
                quantity_limit=rule.quantity_limit,
                configuration=rule.configuration,
            )
        else:
            grant.status = EntitlementGrant.Status.ACTIVE
            grant.starts_at = start
            grant.ends_at = end
            grant.quantity_limit = rule.quantity_limit
            grant.configuration = rule.configuration
            grant.revoked_at = None
            grant.revision += 1
            grant.save()
        EntitlementGrantAudit.objects.create(
            grant=grant,
            action=(
                EntitlementGrantAudit.Action.GRANTED
                if created
                else EntitlementGrantAudit.Action.UPDATED
            ),
            reason_code=f"subscription_{subscription.status}",
            source_reference=str(subscription.id),
            snapshot=_snapshot(grant),
        )
        if created:
            publish_after_commit(
                EntitlementGranted(
                    grant_id=grant.id,
                    user_id=user.id,
                    entitlement_code=grant.entitlement.code,
                    ends_at=grant.ends_at,
                )
            )
    for grant in existing:
        if (
            grant.entitlement_id not in active_ids
            and grant.status == EntitlementGrant.Status.ACTIVE
        ):
            _revoke_locked(grant=grant, reason_code="plan_rule_removed")
    return list(
        EntitlementGrant.objects.filter(
            user=user,
            source_type=EntitlementGrant.SourceType.SUBSCRIPTION,
            source_id=subscription.id,
        ).select_related("entitlement")
    )


def _revoke_locked(
    *, grant: EntitlementGrant, reason_code: str, actor: User | None = None
) -> EntitlementGrant:
    grant.status = EntitlementGrant.Status.REVOKED
    grant.revoked_at = timezone.now()
    grant.revision += 1
    grant.save(update_fields=("status", "revoked_at", "revision"))
    EntitlementGrantAudit.objects.create(
        grant=grant,
        action=EntitlementGrantAudit.Action.REVOKED,
        reason_code=reason_code,
        actor=actor,
        snapshot=_snapshot(grant),
    )
    publish_after_commit(
        EntitlementRevoked(
            grant_id=grant.id,
            user_id=grant.user_id,
            entitlement_code=grant.entitlement.code,
            reason_code=reason_code,
            actor_id=actor.id if actor else None,
        )
    )
    return grant


@transaction.atomic
def grant_manual_entitlement(
    *,
    user: User,
    entitlement_code: str,
    source_id: UUID,
    starts_at: datetime,
    ends_at: datetime | None,
    actor: User,
    reason_code: str,
) -> tuple[EntitlementGrant, bool]:
    if ends_at is not None and ends_at <= starts_at:
        raise ValueError("An entitlement grant must end after it starts.")
    entitlement = EntitlementDefinition.objects.get(
        code=validate_entitlement_code(entitlement_code), is_active=True
    )
    grant, created = EntitlementGrant.objects.select_for_update().get_or_create(
        user=user,
        entitlement=entitlement,
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=source_id,
        defaults={
            "status": EntitlementGrant.Status.ACTIVE,
            "starts_at": starts_at,
            "ends_at": ends_at,
        },
    )
    if not created:
        return grant, False
    EntitlementGrantAudit.objects.create(
        grant=grant,
        action=EntitlementGrantAudit.Action.GRANTED,
        reason_code=reason_code,
        actor=actor,
        snapshot=_snapshot(grant),
    )
    publish_after_commit(
        EntitlementGranted(
            grant_id=grant.id,
            user_id=user.id,
            entitlement_code=entitlement.code,
            ends_at=ends_at,
            actor_id=actor.id,
        )
    )
    return grant, True


@transaction.atomic
def revoke_manual_entitlement(*, grant_id: UUID, actor: User, reason_code: str) -> EntitlementGrant:
    """Revoke one manual override while keeping its immutable grant history."""
    normalized_reason = reason_code.strip()[:80]
    if not normalized_reason:
        raise ValueError("An entitlement revocation reason is required.")
    grant = EntitlementGrant.objects.select_for_update().get(id=grant_id)
    if grant.source_type != EntitlementGrant.SourceType.MANUAL:
        raise ValueError("Only a manual entitlement override can be revoked here.")
    if grant.status == EntitlementGrant.Status.REVOKED:
        return grant
    return _revoke_locked(grant=grant, reason_code=normalized_reason, actor=actor)


def entitlement_decision(
    *, user: User, entitlement_code: str, at: datetime | None = None
) -> EntitlementDecision:
    code = validate_entitlement_code(entitlement_code)
    if not user.is_active or user.status != User.Status.ACTIVE:
        return EntitlementDecision(code=code, allowed=False, reason="account_inactive")
    if user.email_verified_at is None:
        return EntitlementDecision(code=code, allowed=False, reason="verification_required")
    current = at or timezone.now()
    grant = (
        EntitlementGrant.objects.filter(
            user=user,
            entitlement__code=code,
            entitlement__is_active=True,
            status=EntitlementGrant.Status.ACTIVE,
            starts_at__lte=current,
        )
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=current))
        .select_related("entitlement")
        .order_by("ends_at")
        .first()
    )
    if grant is None:
        return EntitlementDecision(code=code, allowed=False, reason="entitlement_required")
    return EntitlementDecision(
        code=code,
        allowed=True,
        reason="granted",
        expires_at=grant.ends_at,
        quantity_limit=int(grant.quantity_limit) if grant.quantity_limit is not None else None,
        configuration=grant.configuration,
    )


def require_entitlement(*, user: User, entitlement_code: str) -> EntitlementDecision:
    decision = entitlement_decision(user=user, entitlement_code=entitlement_code)
    if not decision.allowed:
        raise PermissionDenied(
            detail={
                "message": "This capability requires an active entitlement.",
                "code": decision.reason,
                "entitlement": decision.code,
            }
        )
    return decision

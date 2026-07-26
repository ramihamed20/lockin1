from __future__ import annotations

from collections.abc import Iterable
from datetime import timedelta
from typing import Any, cast
from uuid import UUID, uuid4

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import AccountSecurityEvent, AccountSession, User
from apps.accounts.roles import Role, replace_managed_roles
from apps.accounts.services import build_account_link, invalidate_sessions, request_password_reset
from apps.administration.services import is_final_effective_platform_administrator, lock_effective_platform_administrators
from apps.audit.services import record_audit
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant, PlanEntitlementRule
from apps.entitlements.services import (
    entitlement_decision,
    grant_manual_entitlement,
    revoke_manual_entitlement,
    sync_subscription_entitlements,
)
from apps.notifications.models import Notification
from apps.notifications.services import create_notification
from apps.payments.models import Payment
from apps.payments.services import apply_admin_reconciled_payment_state
from apps.product_catalog.models import Plan, PlanVersion, Product
from apps.product_catalog.services import create_plan_version, create_price, publish_plan_version, publish_price
from apps.subscriptions.models import Subscription, SubscriptionTransition
from apps.subscriptions.services import transition_subscription
from apps.system_configuration.services import get_configuration_value

from .models import (
    AdminInternalNote,
    NotificationCampaign,
    NotificationCampaignDelivery,
    PaymentStatusCorrection,
    SubscriptionAdminEvent,
)


class AdminControlError(ValueError):
    pass


def _snapshot_subscription(subscription: Subscription) -> dict[str, object]:
    return {
        "status": subscription.status,
        "plan_version_id": str(subscription.plan_version_id),
        "current_period_ends_at": (
            subscription.current_period_ends_at.isoformat()
            if subscription.current_period_ends_at
            else None
        ),
        "cancel_at_period_end": subscription.cancel_at_period_end,
        "status_reason": subscription.status_reason,
        "revision": subscription.revision,
    }


def _require_reason(reason: str) -> str:
    clean = reason.strip()
    if len(clean) < 8:
        raise AdminControlError("An administrative reason of at least 8 characters is required.")
    return clean[:500]


def _require_idempotency_key(value: str) -> str:
    key = value.strip()[:180]
    if len(key) < 12:
        raise AdminControlError("A stable idempotency key is required for this action.")
    return key


@transaction.atomic
def request_payment_status_correction(
    *, payment_id: UUID, requested_status: str, provider_reference: str, actor: User,
    reason: str, idempotency_key: str, source: str, correlation_id: UUID | None = None,
    ip_address: str = ""
) -> PaymentStatusCorrection:
    """Create a pending, evidence-backed correction request for a second operator."""
    clean_reason = _require_reason(reason)
    key = _require_idempotency_key(idempotency_key)
    reference = provider_reference.strip()
    if not reference:
        raise AdminControlError("A verified payment-provider reference is required.")
    payment = Payment.objects.select_for_update().get(id=payment_id)
    if requested_status not in (Payment.Status.SUCCEEDED, Payment.Status.FAILED, Payment.Status.CANCELLED):
        raise AdminControlError("This payment status is not eligible for controlled reconciliation.")
    correction, created = PaymentStatusCorrection.objects.get_or_create(
        payment=payment,
        requested_by=actor,
        idempotency_key=key,
        defaults={
            "requested_status": requested_status,
            "provider_reference": reference[:180],
            "reason": clean_reason,
        },
    )
    if not created:
        if correction.requested_status != requested_status or correction.provider_reference != reference[:180]:
            raise AdminControlError("This idempotency key was already used for a different correction request.")
        return correction
    record_audit(
        actor=actor,
        action="administration.payment_correction.requested",
        domain="payments",
        target_type="payments.payment",
        target_id=str(payment.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        ip_address=ip_address,
        previous_state={"status": payment.status},
        new_state={"requested_status": requested_status, "correction_id": str(correction.id)},
        metadata={"provider_reference": reference[:180]},
    )
    return correction


@transaction.atomic
def review_payment_status_correction(
    *, correction_id: UUID, decision: str, actor: User, reason: str, idempotency_key: str,
    source: str, correlation_id: UUID | None = None, ip_address: str = ""
) -> PaymentStatusCorrection:
    """Apply or reject a correction request using separation of duties."""
    clean_reason = _require_reason(reason)
    key = _require_idempotency_key(idempotency_key)
    correction = PaymentStatusCorrection.objects.select_for_update().select_related(
        "payment__account", "requested_by"
    ).get(id=correction_id)
    if correction.status != PaymentStatusCorrection.Status.PENDING:
        if correction.approval_idempotency_key == key:
            return correction
        raise AdminControlError("This correction request has already been reviewed.")
    if correction.requested_by_id == actor.id:
        raise AdminControlError("A different administrator must review a payment correction request.")
    if decision not in {"approve", "reject"}:
        raise AdminControlError("The payment correction decision is invalid.")
    previous = {"payment_status": correction.payment.status, "request_status": correction.status}
    correction.reviewed_by = actor
    correction.review_reason = clean_reason
    correction.approval_idempotency_key = key
    correction.reviewed_at = timezone.now()
    if decision == "approve":
        result = apply_admin_reconciled_payment_state(
            payment_id=correction.payment_id,
            to_status=correction.requested_status,
            provider_reference=correction.provider_reference,
            correction_id=correction.id,
            effective_at=correction.reviewed_at,
        )
        correction.status = PaymentStatusCorrection.Status.APPROVED
        payment_status = result.payment.status
    else:
        correction.status = PaymentStatusCorrection.Status.REJECTED
        payment_status = correction.payment.status
    correction.save(
        update_fields=(
            "reviewed_by", "review_reason", "approval_idempotency_key", "reviewed_at", "status"
        )
    )
    record_audit(
        actor=actor,
        action=f"administration.payment_correction.{decision}d",
        domain="payments",
        target_type="admin_control.payment_status_correction",
        target_id=str(correction.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        ip_address=ip_address,
        previous_state=previous,
        new_state={"request_status": correction.status, "payment_status": payment_status},
        related_entities=[{"type": "payments.payment", "id": str(correction.payment_id)}],
    )
    return correction


@transaction.atomic
def add_internal_note(
    *, actor: User, target_type: str, target_id: str, body: str, reason: str, source: str,
    correlation_id: UUID | None = None, ip_address: str = ""
) -> AdminInternalNote:
    clean_reason = _require_reason(reason)
    clean_body = body.strip()
    if not 3 <= len(clean_body) <= 4000:
        raise AdminControlError("An internal note must contain between 3 and 4000 characters.")
    note = AdminInternalNote.objects.create(
        target_type=target_type[:80], target_id=target_id[:100], author=actor, body=clean_body
    )
    record_audit(
        actor=actor,
        action="administration.internal_note.created",
        domain="administration",
        target_type=note.target_type,
        target_id=note.target_id,
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        metadata={"note_id": note.id, "ip_address": ip_address[:64]},
    )
    return note


@transaction.atomic
def manage_subscription(
    *,
    subscription_id: UUID,
    action: str,
    actor: User,
    reason: str,
    idempotency_key: str,
    note: str = "",
    period_ends_at: Any = None,
    plan_version_id: UUID | None = None,
    source: str,
    correlation_id: UUID | None = None,
    ip_address: str = "",
) -> Subscription:
    """Perform a bounded, fully-audited subscription change.

    Financial settlement remains provider-owned. This service only changes the
    subscription lifecycle and access period after the actor has supplied a
    reason and a replay-safe request key.
    """
    clean_reason = _require_reason(reason)
    key = _require_idempotency_key(idempotency_key)
    subscription = (
        Subscription.objects.select_for_update()
        .select_related("account", "plan_version__plan")
        .get(id=subscription_id)
    )
    previous_event = SubscriptionAdminEvent.objects.filter(
        subscription=subscription, idempotency_key=key
    ).first()
    if previous_event is not None:
        if previous_event.action != action.strip():
            raise AdminControlError("This idempotency key was already used for a different action.")
        return subscription
    previous = _snapshot_subscription(subscription)
    now = timezone.now()
    normalized_action = action.strip()
    if normalized_action in {"activate", "reactivate"}:
        result = transition_subscription(
            subscription_id=subscription.id,
            to_status=Subscription.Status.ACTIVE,
            reason_code=f"admin_{normalized_action}",
            source=SubscriptionTransition.Source.ADMIN,
            effective_at=now,
            idempotency_key=key,
            actor=actor,
        )
        subscription = result.subscription
    elif normalized_action == "suspend":
        subscription = transition_subscription(
            subscription_id=subscription.id,
            to_status=Subscription.Status.SUSPENDED,
            reason_code="admin_suspended",
            source=SubscriptionTransition.Source.ADMIN,
            effective_at=now,
            idempotency_key=key,
            actor=actor,
        ).subscription
    elif normalized_action == "cancel_now":
        subscription = transition_subscription(
            subscription_id=subscription.id,
            to_status=Subscription.Status.CANCELLED,
            reason_code="admin_cancelled",
            source=SubscriptionTransition.Source.ADMIN,
            effective_at=now,
            idempotency_key=key,
            actor=actor,
        ).subscription
    elif normalized_action == "cancel_period_end":
        if subscription.status not in (
            Subscription.Status.TRIALING,
            Subscription.Status.ACTIVE,
            Subscription.Status.GRACE,
        ):
            raise AdminControlError("Only a live subscription can be cancelled at period end.")
        if not subscription.cancel_at_period_end:
            subscription.cancel_at_period_end = True
            subscription.cancellation_requested_at = now
            subscription.status_reason = "admin_cancellation_scheduled"
            subscription.revision += 1
            subscription.save(
                update_fields=(
                    "cancel_at_period_end",
                    "cancellation_requested_at",
                    "status_reason",
                    "revision",
                    "updated_at",
                )
            )
            SubscriptionTransition.objects.create(
                subscription=subscription,
                from_status=subscription.status,
                to_status=subscription.status,
                source=SubscriptionTransition.Source.ADMIN,
                reason_code="admin_cancellation_scheduled",
                actor=actor,
                idempotency_key=key,
                effective_at=now,
            )
    elif normalized_action in {"extend", "change_expiration"}:
        if period_ends_at is None:
            raise AdminControlError("A new expiration date is required.")
        if not subscription.current_period_started_at or period_ends_at <= subscription.current_period_started_at:
            raise AdminControlError("The expiration date must be after the current period start.")
        if normalized_action == "extend" and subscription.current_period_ends_at and period_ends_at <= subscription.current_period_ends_at:
            raise AdminControlError("An extension must move the expiration date forward.")
        subscription.current_period_ends_at = period_ends_at
        subscription.grace_ends_at = period_ends_at + timedelta(days=subscription.plan_version.grace_days)
        subscription.cancel_at_period_end = False
        subscription.cancellation_requested_at = None
        subscription.status_reason = f"admin_{normalized_action}"
        subscription.revision += 1
        subscription.save(
            update_fields=(
                "current_period_ends_at",
                "grace_ends_at",
                "cancel_at_period_end",
                "cancellation_requested_at",
                "status_reason",
                "revision",
                "updated_at",
            )
        )
        SubscriptionTransition.objects.create(
            subscription=subscription,
            from_status=subscription.status,
            to_status=subscription.status,
            source=SubscriptionTransition.Source.ADMIN,
            reason_code=f"admin_{normalized_action}",
            actor=actor,
            idempotency_key=key,
            effective_at=now,
            metadata={"current_period_ends_at": period_ends_at.isoformat()},
        )
    elif normalized_action == "change_plan":
        if plan_version_id is None:
            raise AdminControlError("A target plan version is required.")
        plan_version = PlanVersion.objects.select_related("plan").get(id=plan_version_id)
        if plan_version.plan.status != Plan.Status.ACTIVE or plan_version.published_at is None:
            raise AdminControlError("The target plan version is not active and published.")
        subscription.plan_version = plan_version
        subscription.status_reason = "admin_plan_changed"
        subscription.revision += 1
        subscription.save(update_fields=("plan_version", "status_reason", "revision", "updated_at"))
        SubscriptionTransition.objects.create(
            subscription=subscription,
            from_status=subscription.status,
            to_status=subscription.status,
            source=SubscriptionTransition.Source.ADMIN,
            reason_code="admin_plan_changed",
            actor=actor,
            idempotency_key=key,
            effective_at=now,
            metadata={"plan_version_id": str(plan_version.id)},
        )
    else:
        raise AdminControlError("The requested subscription action is not supported.")

    # The existing entitlement engine remains the sole authority for the
    # access consequences of plan/lifecycle mutations.
    sync_subscription_entitlements(subscription_id=subscription.id)
    subscription.refresh_from_db()
    current = _snapshot_subscription(subscription)
    SubscriptionAdminEvent.objects.create(
        subscription=subscription,
        idempotency_key=key,
        action=normalized_action,
        actor=actor,
        reason=clean_reason,
        note=note.strip()[:4000],
        previous_state=previous,
        new_state=current,
    )
    record_audit(
        actor=actor,
        action=f"administration.subscription.{normalized_action}",
        domain="subscriptions",
        target_type="subscriptions.subscription",
        target_id=str(subscription.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        previous_state=previous,
        new_state=current,
        related_entities=[{"type": "accounts.user", "id": str(subscription.account.primary_user_id)}],
        metadata={"ip_address": ip_address[:64], "note": note.strip()[:4000]},
    )
    return subscription


@transaction.atomic
def change_user_status(
    *, target: User, status: str, actor: User, reason: str, source: str,
    correlation_id: UUID | None = None, ip_address: str = ""
) -> User:
    clean_reason = _require_reason(reason)
    if status not in User.Status.values:
        raise AdminControlError("The account status is invalid.")
    # Mutating a role-bearing account must not be able to lock the platform out
    # of its final active administrator.  The helper locks all effective admins
    # first, so concurrent administrative requests see the same invariant.
    lock_effective_platform_administrators()
    target = User.objects.select_for_update().get(id=target.id)
    previous = {"status": target.status, "is_active": target.is_active}
    if target.id == actor.id and status != User.Status.ACTIVE:
        raise AdminControlError("You cannot suspend or delete your own active administrative account.")
    if status != User.Status.ACTIVE and is_final_effective_platform_administrator(user=target):
        raise AdminControlError("The final active platform administrator cannot be suspended or deleted.")
    target.status = status
    target.save(update_fields=("status", "is_active", "updated_at"))
    if status != User.Status.ACTIVE:
        invalidate_sessions(user=target)
    AccountSecurityEvent.objects.create(
        user=target,
        actor=actor,
        event_type=AccountSecurityEvent.EventType.STATUS_CHANGED,
        metadata={"status": status, "reason": clean_reason},
    )
    record_audit(
        actor=actor,
        action="administration.user.status_changed",
        domain="accounts",
        target_type="accounts.user",
        target_id=str(target.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        previous_state=previous,
        new_state={"status": target.status, "is_active": target.is_active},
        metadata={"ip_address": ip_address[:64]},
    )
    return target


@transaction.atomic
def set_user_verification(
    *, target: User, verified: bool, actor: User, reason: str, source: str,
    correlation_id: UUID | None = None, ip_address: str = ""
) -> User:
    clean_reason = _require_reason(reason)
    target = User.objects.select_for_update().get(id=target.id)
    previous = {"email_verified_at": target.email_verified_at}
    target.email_verified_at = timezone.now() if verified else None
    target.save(update_fields=("email_verified_at", "updated_at"))
    record_audit(
        actor=actor,
        action="administration.user.email_verification_changed",
        domain="accounts",
        target_type="accounts.user",
        target_id=str(target.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        previous_state=previous,
        new_state={"email_verified_at": target.email_verified_at},
        metadata={"ip_address": ip_address[:64]},
    )
    return target


@transaction.atomic
def set_product_roles(
    *, target: User, role_codes: Iterable[str], actor: User, reason: str, source: str,
    correlation_id: UUID | None = None, ip_address: str = ""
) -> tuple[str, ...]:
    clean_reason = _require_reason(reason)
    try:
        roles = {Role(item) for item in role_codes}
    except ValueError as error:
        raise AdminControlError("One or more product roles are invalid.") from error
    # Student is a baseline role, not an assignable group.
    roles.discard(Role.STUDENT)
    previous = tuple(target.groups.values_list("name", flat=True))
    try:
        assigned = replace_managed_roles(target=target, actor=actor, roles=roles)
    except Exception as error:  # role service supplies the stable policy error
        raise AdminControlError(str(error)) from error
    record_audit(
        actor=actor,
        action="administration.user.product_roles_replaced",
        domain="accounts",
        target_type="accounts.user",
        target_id=str(target.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        previous_state={"roles": previous},
        new_state={"roles": assigned},
        metadata={"ip_address": ip_address[:64]},
    )
    return assigned


@transaction.atomic
def force_user_logout(
    *, target: User, actor: User, reason: str, source: str, session_id: UUID | None = None,
    correlation_id: UUID | None = None, ip_address: str = ""
) -> int:
    clean_reason = _require_reason(reason)
    if session_id is None:
        removed = invalidate_sessions(user=target)
    else:
        session = AccountSession.objects.filter(id=session_id, user=target).first()
        if session is None:
            raise AdminControlError("The requested active session was not found.")
        from django.contrib.sessions.models import Session

        Session.objects.filter(session_key=session.session_key).delete()
        AccountSession.objects.filter(id=session.id).delete()
        removed = 1
    record_audit(
        actor=actor,
        action="administration.user.sessions_revoked",
        domain="accounts",
        target_type="accounts.user",
        target_id=str(target.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        new_state={"sessions_revoked": removed},
        metadata={"session_id": str(session_id) if session_id else None, "ip_address": ip_address[:64]},
    )
    return removed


@transaction.atomic
def trigger_password_reset(
    *, target: User, actor: User, reason: str, source: str,
    correlation_id: UUID | None = None, ip_address: str = ""
) -> bool:
    clean_reason = _require_reason(reason)
    issued = request_password_reset(email=target.email)
    if issued is None:
        return False
    user, token = issued
    try:
        send_mail(
            subject="Reset your Lock-in password",
            message=(
                "An administrator requested a password reset for your account.\n\n"
                f"{build_account_link(path='/reset-password', raw_token=token.raw_token)}"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception as error:
        raise AdminControlError("The password reset email could not be sent.") from error
    record_audit(
        actor=actor,
        action="administration.user.password_reset_triggered",
        domain="accounts",
        target_type="accounts.user",
        target_id=str(target.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        metadata={"ip_address": ip_address[:64]},
    )
    return True


def _campaign_recipients(campaign: NotificationCampaign) -> Iterable[User]:
    audience = campaign.audience
    payload = campaign.audience_filter
    users = User.objects.filter(status=User.Status.ACTIVE).order_by("id")
    if audience == NotificationCampaign.Audience.USER:
        return users.filter(id=payload.get("user_id"))
    if audience == NotificationCampaign.Audience.SELECTED_USERS:
        raw_ids = payload.get("user_ids", [])
        return users.filter(id__in=raw_ids[:250] if isinstance(raw_ids, list) else [])
    if audience == NotificationCampaign.Audience.ALL_USERS:
        return users
    if audience == NotificationCampaign.Audience.CREATORS:
        return users.filter(groups__name=Role.CREATOR.value).distinct()
    if audience == NotificationCampaign.Audience.ACTIVE_SUBSCRIBERS:
        return users.filter(
            subscription_accounts__subscriptions__status__in=(
                Subscription.Status.ACTIVE,
                Subscription.Status.TRIALING,
                Subscription.Status.GRACE,
            )
        ).distinct()
    if audience == NotificationCampaign.Audience.EXPIRED_SUBSCRIBERS:
        return users.filter(
            subscription_accounts__subscriptions__status__in=(
                Subscription.Status.EXPIRED,
                Subscription.Status.CANCELLED,
            )
        ).distinct()
    if audience == NotificationCampaign.Audience.TRIAL_USERS:
        return users.filter(subscription_accounts__subscriptions__status=Subscription.Status.TRIALING).distinct()
    if audience == NotificationCampaign.Audience.PLAN_USERS:
        return users.filter(
            subscription_accounts__subscriptions__plan_version__plan__code=payload.get("plan_code"),
            subscription_accounts__subscriptions__status__in=(
                Subscription.Status.ACTIVE,
                Subscription.Status.TRIALING,
                Subscription.Status.GRACE,
            ),
        ).distinct()
    return users.none()


def _email_is_configured() -> bool:
    backend = str(getattr(settings, "EMAIL_BACKEND", ""))
    return backend not in {
        "django.core.mail.backends.console.EmailBackend",
        "django.core.mail.backends.locmem.EmailBackend",
        "django.core.mail.backends.dummy.EmailBackend",
    }


@transaction.atomic
def create_notification_campaign(
    *, actor: User, audience: str, audience_filter: dict[str, object], title: str, body: str,
    send_in_app: bool, send_email: bool, scheduled_for: Any, reason: str, source: str,
    correlation_id: UUID | None = None, ip_address: str = ""
) -> NotificationCampaign:
    clean_reason = _require_reason(reason)
    if audience not in NotificationCampaign.Audience.values:
        raise AdminControlError("The notification audience is invalid.")
    if not send_in_app and not send_email:
        raise AdminControlError("Choose at least one delivery channel.")
    if not title.strip() or not body.strip():
        raise AdminControlError("A notification title and body are required.")
    status = (
        NotificationCampaign.Status.SCHEDULED
        if scheduled_for is not None
        else NotificationCampaign.Status.DRAFT
    )
    if scheduled_for is not None and scheduled_for <= timezone.now():
        raise AdminControlError("Scheduled delivery must be in the future.")
    campaign = NotificationCampaign.objects.create(
        audience=audience,
        audience_filter=audience_filter,
        title=title.strip(),
        body=body.strip(),
        send_in_app=send_in_app,
        send_email=send_email,
        status=status,
        scheduled_for=scheduled_for,
        created_by=actor,
        reason=clean_reason,
    )
    record_audit(
        actor=actor,
        action="administration.notification_campaign.created",
        domain="notifications",
        target_type="admin_control.notification_campaign",
        target_id=str(campaign.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        new_state={"audience": audience, "status": status, "send_in_app": send_in_app, "send_email": send_email},
        metadata={"ip_address": ip_address[:64]},
    )
    return campaign


@transaction.atomic
def dispatch_notification_campaign(
    *, campaign_id: UUID, actor: User, reason: str, source: str,
    correlation_id: UUID | None = None, ip_address: str = ""
) -> NotificationCampaign:
    clean_reason = _require_reason(reason)
    campaign = NotificationCampaign.objects.select_for_update().get(id=campaign_id)
    if campaign.status not in (NotificationCampaign.Status.DRAFT, NotificationCampaign.Status.SCHEDULED):
        raise AdminControlError("This campaign cannot be dispatched in its current state.")
    recipients = _campaign_recipients(campaign)
    recipient_count = recipients.count()
    maximum = int(get_configuration_value("notifications.max_campaign_recipients"))
    if recipient_count > maximum:
        raise AdminControlError(
            f"This campaign targets {recipient_count} users, exceeding the configured synchronous limit of {maximum}."
        )
    campaign.status = NotificationCampaign.Status.PROCESSING
    campaign.save(update_fields=("status", "updated_at"))
    delivered = 0
    failed = 0
    for recipient in recipients.iterator(chunk_size=250):
        notification = None
        in_app_status = "not_requested"
        email_status = "not_requested"
        failure_reason = ""
        try:
            if campaign.send_in_app:
                notification, _ = create_notification(
                    recipient_id=recipient.id,
                    actor_id=actor.id,
                    category=Notification.Category.PLATFORM,
                    template_key="admin_campaign",
                    title=campaign.title,
                    body=campaign.body,
                    deduplication_key=f"campaign:{campaign.id}:{recipient.id}",
                    data={"campaign_id": str(campaign.id)},
                )
                in_app_status = "delivered" if notification is not None else "suppressed"
            if campaign.send_email:
                if not _email_is_configured():
                    email_status = "unavailable"
                else:
                    send_mail(
                        subject=campaign.title,
                        message=campaign.body,
                        from_email=settings.DEFAULT_FROM_EMAIL,
                        recipient_list=[recipient.email],
                        fail_silently=False,
                    )
                    email_status = "delivered"
            if in_app_status == "delivered" or email_status == "delivered":
                delivered += 1
        except Exception as error:
            failed += 1
            if in_app_status == "not_requested":
                in_app_status = "failed"
            if campaign.send_email and email_status == "not_requested":
                email_status = "failed"
            failure_reason = str(error)[:240]
        NotificationCampaignDelivery.objects.get_or_create(
            campaign=campaign,
            recipient=recipient,
            defaults={
                "in_app_notification": notification,
                "in_app_status": in_app_status,
                "email_status": email_status,
                "failure_reason": failure_reason,
            },
        )
    campaign.delivered_count = delivered
    campaign.failed_count = failed
    campaign.completed_at = timezone.now()
    campaign.status = (
        NotificationCampaign.Status.FAILED if failed and not delivered else NotificationCampaign.Status.COMPLETED
    )
    campaign.save(
        update_fields=(
            "status", "delivered_count", "failed_count", "completed_at", "updated_at"
        )
    )
    record_audit(
        actor=actor,
        action="administration.notification_campaign.dispatched",
        domain="notifications",
        target_type="admin_control.notification_campaign",
        target_id=str(campaign.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        new_state={"status": campaign.status, "delivered_count": delivered, "failed_count": failed},
        metadata={"ip_address": ip_address[:64]},
    )
    return campaign


@transaction.atomic
def grant_access_override(
    *, user: User, entitlement_code: str, starts_at: Any, ends_at: Any, actor: User,
    reason: str, source: str, correlation_id: UUID | None = None, ip_address: str = ""
) -> EntitlementGrant:
    clean_reason = _require_reason(reason)
    if starts_at is None:
        starts_at = timezone.now()
    grant, _ = grant_manual_entitlement(
        user=user,
        entitlement_code=entitlement_code,
        source_id=uuid4(),
        starts_at=starts_at,
        ends_at=ends_at,
        actor=actor,
        reason_code="admin_manual_grant",
    )
    record_audit(
        actor=actor,
        action="administration.entitlement.granted",
        domain="entitlements",
        target_type="entitlements.grant",
        target_id=str(grant.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        new_state={"user_id": str(user.id), "entitlement": entitlement_code, "ends_at": ends_at},
        metadata={"ip_address": ip_address[:64]},
    )
    return grant


@transaction.atomic
def revoke_access_override(
    *, grant_id: UUID, actor: User, reason: str, source: str,
    correlation_id: UUID | None = None, ip_address: str = ""
) -> EntitlementGrant:
    clean_reason = _require_reason(reason)
    grant = revoke_manual_entitlement(
        grant_id=grant_id, actor=actor, reason_code="admin_manual_revocation"
    )
    record_audit(
        actor=actor,
        action="administration.entitlement.revoked",
        domain="entitlements",
        target_type="entitlements.grant",
        target_id=str(grant.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        previous_state={"status": EntitlementGrant.Status.ACTIVE},
        new_state={"status": grant.status, "revoked_at": grant.revoked_at},
        metadata={"ip_address": ip_address[:64]},
    )
    return grant


def entitlement_inspection(*, user: User) -> dict[str, object]:
    grants = list(
        EntitlementGrant.objects.filter(user=user)
        .select_related("entitlement")
        .order_by("-created_at")
    )
    definitions = EntitlementDefinition.objects.filter(is_active=True).order_by("code")
    decisions = [
        {
            "code": definition.code,
            "allowed": (decision := entitlement_decision(user=user, entitlement_code=definition.code)).allowed,
            "reason": decision.reason,
            "expires_at": decision.expires_at,
        }
        for definition in definitions
    ]
    return {"grants": grants, "effective_permissions": decisions}


def serialize_plan(plan: Plan) -> dict[str, object]:
    versions = plan.versions.prefetch_related("prices", "entitlement_rules__entitlement").all()
    return {
        "id": plan.id,
        "code": plan.code,
        "status": plan.status,
        "product": {"id": plan.product_id, "code": plan.product.code, "title": plan.product.title},
        "current_version_id": plan.current_version_id,
        "versions": [
            {
                "id": version.id,
                "version": version.version,
                "title": version.title,
                "description": version.description,
                "audience": version.audience,
                "trial_days": version.trial_days,
                "grace_days": version.grace_days,
                "terms": version.terms,
                "published_at": version.published_at,
                "prices": [
                    {
                        "id": price.id,
                        "code": price.code,
                        "amount_minor": price.amount_minor,
                        "currency": price.currency,
                        "currency_exponent": price.currency_exponent,
                        "region_code": price.region_code,
                        "interval": price.interval,
                        "interval_count": price.interval_count,
                        "status": price.status,
                    }
                    for price in version.prices.all()
                ],
                "entitlements": [
                    {
                        "code": rule.entitlement.code,
                        "title": rule.entitlement.title,
                        "quantity_limit": rule.quantity_limit,
                        "configuration": rule.configuration,
                    }
                    for rule in version.entitlement_rules.all()
                ],
            }
            for version in versions
        ],
    }


@transaction.atomic
def create_admin_plan_version(
    *, actor: User, payload: dict[str, Any], source: str, correlation_id: UUID | None = None,
    ip_address: str = ""
) -> Plan:
    clean_reason = _require_reason(str(payload["reason"]))
    product = Product.objects.select_for_update().get(id=payload["product_id"])
    version = create_plan_version(
        product=product,
        plan_code=str(payload["plan_code"]),
        title=str(payload["title"]),
        description=str(payload.get("description", "")),
        audience=str(payload["audience"]),
        trial_days=int(payload["trial_days"]),
        grace_days=int(payload["grace_days"]),
        terms=cast(dict[str, object], payload.get("terms", {})),
    )
    for price_payload in cast(list[dict[str, Any]], payload["prices"]):
        create_price(
            plan_version=version,
            code=str(price_payload["code"]),
            amount_minor=int(price_payload["amount_minor"]),
            currency=str(price_payload["currency"]),
            currency_exponent=int(price_payload["currency_exponent"]),
            interval=str(price_payload["interval"]),
            interval_count=int(price_payload["interval_count"]),
            region_code=str(price_payload.get("region_code", "")),
        )
    for entitlement_payload in cast(list[dict[str, Any]], payload.get("entitlements", [])):
        entitlement = EntitlementDefinition.objects.get(
            code=str(entitlement_payload["entitlement_code"]), is_active=True
        )
        PlanEntitlementRule.objects.create(
            plan_version=version,
            entitlement=entitlement,
            quantity_limit=entitlement_payload.get("quantity_limit"),
            configuration=cast(dict[str, object], entitlement_payload.get("configuration", {})),
        )
    if bool(payload["publish"]):
        publish_plan_version(plan_version=version)
        for price in version.prices.all():
            publish_price(price=price)
    plan = Plan.objects.select_related("product", "current_version").get(id=version.plan_id)
    record_audit(
        actor=actor,
        action="administration.plan_version.created",
        domain="product_catalog",
        target_type="product_catalog.plan",
        target_id=str(plan.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        new_state={"plan_code": plan.code, "version_id": str(version.id), "published": bool(payload["publish"])},
        metadata={"ip_address": ip_address[:64]},
    )
    return plan


@transaction.atomic
def change_plan_lifecycle(
    *, plan_id: UUID, action: str, actor: User, reason: str, source: str,
    correlation_id: UUID | None = None, ip_address: str = ""
) -> Plan:
    clean_reason = _require_reason(reason)
    plan = Plan.objects.select_for_update().select_related("product", "current_version").get(id=plan_id)
    previous = {"status": plan.status, "current_version_id": str(plan.current_version_id) if plan.current_version_id else None}
    if action == "retire":
        plan.status = Plan.Status.ARCHIVED
    elif action == "restore":
        if plan.current_version_id is None:
            raise AdminControlError("A plan without a published version cannot be restored.")
        plan.status = Plan.Status.ACTIVE
    elif action == "publish":
        if plan.current_version is None:
            latest = plan.versions.order_by("-version").first()
            if latest is None:
                raise AdminControlError("The plan has no version to publish.")
            publish_plan_version(plan_version=latest)
            for price in latest.prices.all():
                publish_price(price=price)
            plan.refresh_from_db()
        else:
            plan.status = Plan.Status.ACTIVE
    else:
        raise AdminControlError("The plan lifecycle action is not supported.")
    plan.save(update_fields=("status", "updated_at"))
    record_audit(
        actor=actor,
        action=f"administration.plan.{action}",
        domain="product_catalog",
        target_type="product_catalog.plan",
        target_id=str(plan.id),
        reason=clean_reason,
        source=source,
        correlation_id=correlation_id,
        previous_state=previous,
        new_state={"status": plan.status, "current_version_id": str(plan.current_version_id) if plan.current_version_id else None},
        metadata={"ip_address": ip_address[:64]},
    )
    return plan

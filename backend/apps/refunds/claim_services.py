from datetime import datetime, timedelta
from typing import TypedDict
from uuid import UUID

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.services import record_audit
from apps.entitlements.models import EntitlementGrant, PlanEntitlementRule
from apps.entitlements.services import grant_manual_entitlement, revoke_manual_entitlement
from apps.invoices.services import apply_invoice_refund
from apps.notifications.models import Notification
from apps.notifications.services import create_notification
from apps.payments.models import InstallmentAgreement, Payment
from apps.payments.services import apply_successful_refund
from apps.subscriptions.models import Subscription, SubscriptionTransition
from apps.subscriptions.services import transition_subscription

from .models import Refund, RefundClaim, RefundTransition
from .policy import voluntary_rate
from .services import request_refund


class Allocation(TypedDict):
    payment_id: str
    amount_minor: int


OPEN = (
    RefundClaim.Status.REQUESTED,
    RefundClaim.Status.NEEDS_INFO,
    RefundClaim.Status.APPROVED,
    RefundClaim.Status.COMPENSATING,
)


def purchase_payments(payment: Payment):  # type: ignore[no-untyped-def]
    query = Payment.objects.filter(id=payment.id)
    if payment.installment_agreement_id:
        query = Payment.objects.filter(installment_agreement_id=payment.installment_agreement_id)
    return query.select_related("manual_submission", "installment_agreement").order_by(
        "created_at", "id"
    )


def allocation_quote(payment: Payment, *, kind: str, received_at: datetime) -> list[Allocation]:
    result: list[Allocation] = []
    rate = (
        voluntary_rate(payment, received_at=received_at)
        if kind in {RefundClaim.Kind.VOLUNTARY, RefundClaim.Kind.TERMINATION}
        else 100
    )
    for item in purchase_payments(payment):
        if item.status not in {Payment.Status.SUCCEEDED, Payment.Status.PARTIALLY_REFUNDED}:
            continue
        reserved = (
            item.refunds.filter(
                status__in=(Refund.Status.REQUESTED, Refund.Status.PENDING, Refund.Status.SUCCEEDED)
            ).aggregate(total=Sum("amount_minor"))["total"]
            or 0
        )
        amount = max(0, item.amount_minor * rate // 100 - reserved)
        if amount:
            result.append({"payment_id": str(item.id), "amount_minor": amount})
    return result


def _notify(claim: RefundClaim, *, label: str) -> None:
    create_notification(
        recipient_id=claim.user_id,
        category=Notification.Category.BILLING,
        template_key="billing.refund.request",
        title=label,
        body=claim.decision_reason
        or "تم استلام طلبك وحفظ وقت وصوله. تابع تفاصيله من صفحة الاشتراك.",
        deduplication_key=f"refund-claim:{claim.id}:{claim.status}:{claim.updated_at.isoformat()}",
        target_route="/subscription",
        required=True,
    )


@transaction.atomic
def create_claim(
    *,
    payment_id: UUID,
    user: User,
    actor: User,
    kind: str,
    remedy: str,
    reason: str,
    receiver_phone: str,
    idempotency_key: str,
    received_at: datetime | None = None,
    channel: str = "website",
) -> tuple[RefundClaim, bool]:
    if len(idempotency_key) < 12:
        raise ValueError("A stable idempotency key is required.")
    # The same account lock as payment submission serializes money/access decisions.
    from apps.subscriptions.services import lock_individual_account

    lock_individual_account(user=user)
    payment = Payment.objects.select_related("account", "installment_agreement").get(
        id=payment_id, account__primary_user=user
    )
    if payment.installment_agreement is not None:
        payment = payment.installment_agreement.payments.get(installment_number=1)
    existing = RefundClaim.objects.filter(user=user, idempotency_key=idempotency_key).first()
    if existing is not None:
        if existing.payment_id != payment.id:
            raise ValueError("This key already belongs to another purchase.")
        return existing, False
    existing = RefundClaim.objects.filter(payment=payment, status__in=OPEN).first()
    if existing:
        return existing, False
    now = timezone.now()
    received = received_at or now
    if received > now or received < payment.created_at:
        raise ValueError("The receipt time must be between purchase submission and now.")
    if kind not in RefundClaim.Kind.values or remedy not in {"refund", "extension", "terminate"}:
        raise ValueError("Choose a valid request and remedy.")
    if remedy == "extension" and kind != RefundClaim.Kind.PLATFORM_ERROR:
        raise ValueError("Compensation is an optional remedy for a platform error.")
    if (
        kind == RefundClaim.Kind.TERMINATION or remedy == "terminate"
    ) and not payment.installment_agreement_id:
        raise ValueError("This purchase has no installment agreement.")
    allocations = allocation_quote(payment, kind=kind, received_at=received)
    claim = RefundClaim.objects.create(
        user=user,
        payment=payment,
        kind=kind,
        remedy=remedy,
        reason=reason,
        receiver_phone=receiver_phone,
        received_at=received,
        due_at=received + timedelta(hours=48),
        channel=channel,
        idempotency_key=idempotency_key,
        policy_version=str(payment.price_snapshot.get("policy_version", "")),
        quoted_amount_minor=sum(int(row["amount_minor"]) for row in allocations),
    )
    record_audit(
        actor=actor,
        action="refund.claim.received",
        domain="refunds",
        target_type="refunds.refund_claim",
        target_id=str(claim.id),
        reason=reason,
        source=f"refunds.{channel}",
        new_state={
            "received_at": received.isoformat(),
            "due_at": claim.due_at.isoformat(),
            "kind": kind,
            "remedy": remedy,
        },
    )
    _notify(claim, label="تم استلام طلب الاسترداد أو الإلغاء")
    return claim, True


def _cancel_purchase(claim: RefundClaim, actor: User) -> None:
    payment = claim.payment
    sub = Subscription.objects.select_for_update().get(id=payment.subscription_id)
    try:
        reviewed_submission = payment.manual_submission
    except Payment.manual_submission.RelatedObjectDoesNotExist:
        reviewed_submission = None
    if reviewed_submission and reviewed_submission.status == "rejected":
        return  # Its access reservation was already rolled back at rejection.
    # A newer purchase is a separate right; never cancel it incidentally.
    group = purchase_payments(payment)
    latest = group.last()
    if (
        latest
        and Payment.objects.filter(
            subscription=sub,
            created_at__gt=latest.created_at,
            status__in=(Payment.Status.SUCCEEDED, Payment.Status.PENDING),
        )
        .exclude(id__in=group.values("id"))
        .exists()
    ):
        raise ValueError(
            "A later purchase exists. Adjust its access separately "
            "before approving this cancellation."
        )
    if sub.provisional_payment_id in set(group.values_list("id", flat=True)):
        sub.provisional_payment_id = None
        sub.save(update_fields=("provisional_payment_id", "updated_at"))
    if payment.installment_agreement_id:
        InstallmentAgreement.objects.filter(id=payment.installment_agreement_id).update(
            status=InstallmentAgreement.Status.CANCELLED, cancelled_at=timezone.now()
        )
    try:
        submission = payment.manual_submission
    except Payment.manual_submission.RelatedObjectDoesNotExist:
        submission = None
    if submission and submission.is_early_renewal:
        previous = submission.previous_subscription_state
        old_end = submission.previous_subscription_end_at
        if sub.current_period_ends_at != submission.subscription_period_ends_at or old_end is None:
            raise ValueError(
                "The earlier paid period requires operator review before removing this renewal."
            )
        from django.utils.dateparse import parse_datetime

        old_start = parse_datetime(str(previous.get("current_period_started_at", "")))
        old_plan = previous.get("plan_version_id")
        if old_plan:
            sub.plan_version_id = UUID(str(old_plan))
            sub.save(update_fields=("plan_version", "updated_at"))
        target = (
            Subscription.Status.ACTIVE if old_end > timezone.now() else Subscription.Status.EXPIRED
        )
        # ACTIVE -> EXPIRED and ACTIVE -> ACTIVE are already domain transitions.
        if sub.status in {Subscription.Status.ACTIVE, Subscription.Status.GRACE}:
            transition_subscription(
                subscription_id=sub.id,
                to_status=target,
                reason_code="renewal_cancelled",
                source=SubscriptionTransition.Source.ADMIN,
                effective_at=timezone.now(),
                idempotency_key=f"claim-access:{claim.id}",
                actor=actor,
                period_started_at=old_start,
                period_ends_at=old_end,
            )
        else:
            raise ValueError("Restore the earlier period before cancelling this renewal.")
    elif sub.status in {
        Subscription.Status.ACTIVE,
        Subscription.Status.GRACE,
        Subscription.Status.SUSPENDED,
        Subscription.Status.PENDING,
        Subscription.Status.TRIALING,
    }:
        transition_subscription(
            subscription_id=sub.id,
            to_status=Subscription.Status.CANCELLED,
            reason_code="refund_or_installment_termination",
            source=SubscriptionTransition.Source.ADMIN,
            effective_at=timezone.now(),
            idempotency_key=f"claim-access:{claim.id}",
            actor=actor,
        )


@transaction.atomic
def review_claim(
    *,
    claim_id: UUID,
    actor: User,
    action: str,
    reason: str,
    transfer_reference: str = "",
    transferred_to: str = "",
    transferred_amount_minor: int | None = None,
) -> RefundClaim:
    stub = RefundClaim.objects.select_related("payment").get(id=claim_id)
    # Consistent account -> subscription -> claim -> payment order.
    from apps.subscriptions.models import SubscriptionAccount

    SubscriptionAccount.objects.select_for_update().get(id=stub.payment.account_id)
    Subscription.objects.select_for_update().get(id=stub.payment.subscription_id)
    claim = (
        RefundClaim.objects.select_for_update(of=("self",))
        .select_related("payment__installment_agreement", "user")
        .get(id=claim_id)
    )
    if len(reason.strip()) < 8:
        raise ValueError("An explanatory decision reason is required.")
    before = claim.status
    if action == "complete" and before == RefundClaim.Status.COMPLETED:
        if claim.transfer_reference != transfer_reference:
            raise ValueError("This transfer is already recorded with a different reference.")
        return claim
    if action == "approve":
        if before == RefundClaim.Status.APPROVED:
            return claim
        if (
            before not in {RefundClaim.Status.REQUESTED, RefundClaim.Status.NEEDS_INFO}
            or claim.remedy == "extension"
        ):
            raise ValueError("This request cannot be approved for a transfer.")
        claim.allocations = allocation_quote(
            claim.payment, kind=claim.kind, received_at=claim.received_at
        )
        claim.approved_amount_minor = sum(int(row["amount_minor"]) for row in claim.allocations)
        if not claim.approved_amount_minor and claim.kind != RefundClaim.Kind.TERMINATION:
            raise ValueError(
                "No settled refundable amount was found. Review partially collected cards "
                "or the statutory claim; do not discard the request."
            )
        # Reserve every payment in the same transaction; time is original receipt, not approval.
        for row in claim.allocations:
            request_refund(
                payment_id=UUID(str(row["payment_id"])),
                actor=actor,
                amount_minor=int(row["amount_minor"]),
                reason=claim.reason[:240],
                idempotency_key=f"claim:{claim.id}:{row['payment_id']}",
                reason_type="voluntary"
                if claim.kind == RefundClaim.Kind.TERMINATION
                else claim.kind,
                received_at=claim.received_at,
            )
        _cancel_purchase(claim, actor)
        claim.status = (
            RefundClaim.Status.APPROVED
            if claim.approved_amount_minor
            else RefundClaim.Status.RESOLVED
        )
    elif action == "complete":
        if before != RefundClaim.Status.APPROVED or not transfer_reference.strip():
            raise ValueError("Approve the request and supply the actual transfer reference first.")
        if not claim.receiver_phone:
            raise ValueError("Record the agreed recipient details before confirming the transfer.")
        if (
            transferred_to != claim.receiver_phone
            or transferred_amount_minor != claim.approved_amount_minor
        ):
            raise ValueError(
                "Confirm the actual recipient and the entire approved net amount. "
                "Reload if the recipient changed."
            )
        for row in claim.allocations:
            refund = Refund.objects.select_for_update().get(
                payment_id=row["payment_id"],
                idempotency_key=f"claim:{claim.id}:{row['payment_id']}",
            )
            if refund.status == Refund.Status.SUCCEEDED:
                continue
            apply_successful_refund(
                payment_id=refund.payment_id, amount_minor=refund.amount_minor, refund_id=refund.id
            )
            apply_invoice_refund(
                payment_id=refund.payment_id, refund_id=refund.id, amount_minor=refund.amount_minor
            )
            refund.status = Refund.Status.SUCCEEDED
            refund.succeeded_at = timezone.now()
            refund.revision += 1
            refund.save()
            RefundTransition.objects.create(
                refund=refund,
                from_status=Refund.Status.REQUESTED,
                to_status=Refund.Status.SUCCEEDED,
                source=RefundTransition.Source.ADMIN,
                reason_code="manual_airtime_transfer_confirmed",
                idempotency_key=f"claim-completed:{claim.id}",
                source_reference=transfer_reference,
                effective_at=refund.succeeded_at,
            )
        claim.status = RefundClaim.Status.COMPLETED
        claim.transfer_reference = transfer_reference.strip()
        claim.completed_at = timezone.now()
    elif action == "compensate":
        if before == RefundClaim.Status.COMPENSATING:
            return claim
        if (
            before not in {RefundClaim.Status.REQUESTED, RefundClaim.Status.NEEDS_INFO}
            or claim.remedy != "extension"
        ):
            raise ValueError("Free compensation requires the user's explicit extension choice.")
        for rule in PlanEntitlementRule.objects.select_related("entitlement").filter(
            plan_version_id=claim.payment.price.plan_version_id
        ):
            grant_manual_entitlement(
                user=claim.user,
                entitlement_code=rule.entitlement.code,
                source_id=claim.id,
                starts_at=timezone.now(),
                ends_at=None,
                actor=actor,
                reason_code="user_chose_service_compensation",
                quantity_limit=rule.quantity_limit,
                configuration=rule.configuration,
            )
        claim.status = RefundClaim.Status.COMPENSATING
    elif action == "restore":
        if before != RefundClaim.Status.COMPENSATING:
            raise ValueError("This request has no active compensation.")
        for grant in EntitlementGrant.objects.filter(
            source_id=claim.id, source_type=EntitlementGrant.SourceType.MANUAL
        ):
            revoke_manual_entitlement(
                grant_id=grant.id, actor=actor, reason_code="service_restored"
            )
        claim.status = RefundClaim.Status.RESOLVED
        claim.completed_at = timezone.now()
    elif action in {"needs_info", "reject"}:
        if before not in {RefundClaim.Status.REQUESTED, RefundClaim.Status.NEEDS_INFO}:
            raise ValueError("This request has already been decided.")
        claim.status = (
            RefundClaim.Status.NEEDS_INFO if action == "needs_info" else RefundClaim.Status.REJECTED
        )
    else:
        raise ValueError("Choose a valid review action.")
    claim.decision_reason = reason.strip()
    claim.reviewed_by = actor
    claim.reviewed_at = timezone.now()
    claim.save()
    record_audit(
        actor=actor,
        action=f"refund.claim.{action}",
        domain="refunds",
        target_type="refunds.refund_claim",
        target_id=str(claim.id),
        reason=reason,
        source="refunds.finance",
        previous_state={"status": before},
        new_state={"status": claim.status, "amount_minor": claim.approved_amount_minor},
    )
    _notify(claim, label="تحديث طلب الاسترداد أو الإلغاء")
    return claim

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Any

from django.db.models import Avg, Count, Exists, Min, OuterRef, Q, QuerySet, Sum
from django.db.models.functions import TruncDate

from apps.accounts.models import AccountSecurityEvent, AccountSession, User
from apps.accounts.roles import Role, get_user_roles
from apps.administration.permissions import operational_capabilities
from apps.assessments.models import Attempt, AttemptResult, Quiz
from apps.audit.models import AuditRecord
from apps.content.models import LearningObject
from apps.entitlements.models import EntitlementGrant
from apps.focus.models import FocusSession
from apps.notifications.models import NotificationDelivery
from apps.payments.manual_services import recharge_code_for_admin, recharge_codes_for_admin
from apps.payments.models import ManualRechargeCode, ManualRechargeSubmission, Payment
from apps.progress.models import LearningProgress
from apps.provider_integrations.models import ProviderObjectLink
from apps.questions.models import Question
from apps.refunds.models import Refund
from apps.subscriptions.models import Subscription

from .models import (
    AdminInternalNote,
    NotificationCampaign,
    PaymentStatusCorrection,
    SubscriptionAdminEvent,
)

# Sorting is decided here rather than in the console, because the console only
# ever holds one page: re-ordering those rows in the browser would produce a
# confident, wrong answer to "which card has been waiting longest".
PURCHASE_ORDERINGS: dict[str, tuple[str, ...]] = {
    "newest": ("-created_at", "-id"),
    "oldest": ("created_at", "id"),
    "amount_high": ("-amount_minor", "-created_at", "-id"),
    "amount_low": ("amount_minor", "-created_at", "-id"),
}

SUBSCRIPTION_ORDERINGS: dict[str, tuple[str, ...]] = {
    "newest": ("-created_at", "-id"),
    "oldest": ("created_at", "id"),
    "expiring": ("current_period_ends_at", "-created_at", "-id"),
}


def admin_purchases(
    *, query: str = "", status: str = "", sort: str = "newest", include_history: bool = True
) -> QuerySet[Payment]:
    payments = Payment.objects.select_related(
        "account__primary_user",
        "account__primary_user__cohort__program",
        "subscription__plan_version__plan",
        "price",
        "manual_submission__reviewed_by",
        "invoice",
    ).prefetch_related("manual_submission__recharge_codes")
    if include_history:
        payments = payments.prefetch_related(
            "transitions", "refunds__transitions", "invoice__lines", "invoice__transitions"
        )
    if status == "pending_review":
        payments = payments.filter(
            manual_submission__status=ManualRechargeSubmission.Status.PENDING
        )
    elif status == "approved":
        payments = payments.filter(
            manual_submission__status=ManualRechargeSubmission.Status.APPROVED
        )
    elif status == "rejected":
        payments = payments.filter(
            manual_submission__status=ManualRechargeSubmission.Status.REJECTED
        )
    elif status:
        payments = payments.filter(status=status)
    if query:
        payments = payments.filter(
            Q(id__icontains=query)
            | Q(account__primary_user__email__icontains=query)
            | Q(account__primary_user__full_name__icontains=query)
            | Q(account__primary_user__username__icontains=query)
            | Q(invoice__number__icontains=query)
            | Q(price__plan_version__plan__code__icontains=query)
        )
    return payments.order_by(*PURCHASE_ORDERINGS.get(sort, PURCHASE_ORDERINGS["newest"]))


def _repeat_submission_count(manual: ManualRechargeSubmission) -> int:
    """How many earlier submissions used any of this submission's card numbers.

    Zero for a first-time card. Digests are HMACs of the number, so this compares
    cards without reading them.
    """

    digests = [code.digest for code in manual.recharge_codes.all()] or [manual.recharge_code_digest]
    return (
        ManualRechargeCode.objects.filter(digest__in=digests)
        .exclude(submission_id=manual.id)
        .values("submission_id")
        .distinct()
        .count()
    )


def serialize_purchase(
    payment: Payment,
    *,
    detailed: bool = False,
    reveal_recharge_code: bool = False,
    repeat_submission_count: int | None = None,
) -> dict[str, Any]:
    user = payment.account.primary_user
    cohort = user.cohort if user else None
    subscription = payment.subscription
    payload: dict[str, Any] = {
        "id": payment.id,
        "status": payment.status,
        "method": payment.method,
        "amount_minor": payment.amount_minor,
        "currency": payment.currency,
        "currency_exponent": payment.currency_exponent,
        "refunded_amount_minor": payment.refunded_amount_minor,
        "transaction_id": str(payment.id),
        "created_at": payment.created_at,
        "initiated_at": payment.initiated_at,
        "succeeded_at": payment.succeeded_at,
        "failed_at": payment.failed_at,
        "failure_code": payment.failure_code,
        "plan_code": payment.price_snapshot.get("plan_code", ""),
        "plan_title": payment.price_snapshot.get("plan_title", ""),
        "user": {
            "id": user.id if user else None,
            "email": user.email if user else "",
            "full_name": user.full_name if user else "",
            "username": user.username if user else "",
            "education": {
                "program_code": cohort.program.code if cohort else "",
                "program_name_en": cohort.program.name_en if cohort else "",
                "program_name_ar": cohort.program.name_ar if cohort else "",
                "cohort_code": cohort.code if cohort else "",
                "cohort_name_en": cohort.name_en if cohort else "",
                "cohort_name_ar": cohort.name_ar if cohort else "",
            },
        },
        "subscription": {
            "id": subscription.id,
            "status": subscription.status,
            "current_period_ends_at": subscription.current_period_ends_at,
            "trial_ends_at": subscription.trial_ends_at,
            "payment_verification": subscription.payment_verification,
            "plan_title": subscription.plan_version.title,
        },
        "invoice_id": str(payment.invoice.id) if hasattr(payment, "invoice") else None,
        "invoice_number": payment.invoice.number if hasattr(payment, "invoice") else "",
    }
    try:
        manual = payment.manual_submission
    except ManualRechargeSubmission.DoesNotExist:
        manual = None
    payload["manual_submission"] = (
        {
            "id": manual.id,
            "status": manual.status,
            "recharge_code_masked": f"•••• {manual.recharge_code_last4}",
            "recharge_codes_masked": [f"•••• {code.last4}" for code in manual.recharge_codes.all()]
            or [f"•••• {manual.recharge_code_last4}"],
            "submitted_at": manual.submitted_at,
            "reviewed_at": manual.reviewed_at,
            "reviewed_by_name": manual.reviewed_by.full_name if manual.reviewed_by else "",
            "rejection_reason": manual.rejection_reason,
            "is_early_renewal": manual.is_early_renewal,
            "subscription_period_started_at": manual.subscription_period_started_at,
            "subscription_period_ends_at": manual.subscription_period_ends_at,
            # A repeat is context for the reviewer, not a verdict. The same card
            # number may legitimately be submitted again -- an earlier attempt
            # may have been rejected in error, or the reader may simply be
            # retrying -- so the count is shown and the decision stays manual.
            "repeat_submission_count": (
                _repeat_submission_count(manual)
                if repeat_submission_count is None
                else repeat_submission_count
            ),
        }
        if manual
        else None
    )
    if not detailed:
        return payload
    invoice = payment.invoice if hasattr(payment, "invoice") else None
    payload.update(
        {
            "provider_data": [
                {
                    "provider": link.provider,
                    "external_id": link.external_id,
                    "created_at": link.created_at,
                }
                for link in ProviderObjectLink.objects.filter(
                    object_type=ProviderObjectLink.ObjectType.PAYMENT,
                    internal_id=payment.id,
                ).order_by("provider")
            ],
            "price_snapshot": payment.price_snapshot,
            "revision": payment.revision,
            "transitions": [
                {
                    "id": item.id,
                    "from_status": item.from_status,
                    "to_status": item.to_status,
                    "source": item.source,
                    "reason_code": item.reason_code,
                    "effective_at": item.effective_at,
                    "metadata": item.metadata,
                }
                for item in payment.transitions.all()
            ],
            "refunds": [
                {
                    "id": refund.id,
                    "amount_minor": refund.amount_minor,
                    "status": refund.status,
                    "reason": refund.reason,
                    "requested_at": refund.requested_at,
                    "succeeded_at": refund.succeeded_at,
                    "failure_code": refund.failure_code,
                }
                for refund in payment.refunds.all()
            ],
            "invoice": (
                {
                    "id": invoice.id,
                    "number": invoice.number,
                    "status": invoice.status,
                    "total_minor": invoice.total_minor,
                    "amount_paid_minor": invoice.amount_paid_minor,
                    "amount_refunded_minor": invoice.amount_refunded_minor,
                    "issued_at": invoice.issued_at,
                    "lines": [
                        {
                            "description": line.description,
                            "quantity": line.quantity,
                            "amount_minor": line.amount_minor,
                            "plan_code": line.plan_code,
                        }
                        for line in invoice.lines.all()
                    ],
                }
                if invoice
                else None
            ),
            "notes": list(
                AdminInternalNote.objects.filter(
                    target_type="payments.payment", target_id=str(payment.id)
                )
                .select_related("author")
                .order_by("-created_at")
            ),
            "status_corrections": list(
                PaymentStatusCorrection.objects.filter(payment=payment)
                .select_related("requested_by", "reviewed_by")
                .order_by("-created_at")
            ),
        }
    )
    if manual is not None and reveal_recharge_code:
        payload["manual_submission"]["recharge_code"] = recharge_code_for_admin(manual)
        payload["manual_submission"]["recharge_codes"] = recharge_codes_for_admin(manual)
    return payload


def serialize_purchase_list(payments: Sequence[Payment]) -> list[dict[str, Any]]:
    """Resolve shared-card context once for the current bounded page.

    A submission matching two of the target's cards still counts only once.
    Preserve the detail serializer's legacy fallback and global history scope.
    """
    digests_by_payment: dict[Payment, set[str]] = {}
    for payment in payments:
        try:
            manual = payment.manual_submission
        except ManualRechargeSubmission.DoesNotExist:
            continue
        digests_by_payment[payment] = {code.digest for code in manual.recharge_codes.all()} or {
            manual.recharge_code_digest
        }
    digests = set().union(*digests_by_payment.values()) if digests_by_payment else set()
    matches: dict[str, set[object]] = {}
    if digests:
        for digest, submission_id in (
            ManualRechargeCode.objects.filter(digest__in=digests)
            .order_by()
            .values_list("digest", "submission_id")
            .distinct()
        ):
            matches.setdefault(digest, set()).add(submission_id)
    payloads = []
    for payment in payments:
        count = 0
        if payment in digests_by_payment:
            seen = set().union(
                *(matches.get(digest, set()) for digest in digests_by_payment[payment])
            )
            seen.discard(payment.manual_submission.id)
            count = len(seen)
        payloads.append(serialize_purchase(payment, repeat_submission_count=count))
    return payloads


def admin_subscriptions(
    *, query: str = "", status: str = "", missing_only: bool = False, sort: str = "newest"
) -> QuerySet[User] | QuerySet[Subscription]:
    users = User.objects.select_related().all()
    if missing_only:
        users = users.exclude(subscription_accounts__subscriptions__isnull=False)
        if query:
            users = users.filter(Q(email__icontains=query) | Q(full_name__icontains=query))
        return users.order_by("-date_joined")
    subscriptions = Subscription.objects.select_related(
        "account__primary_user__cohort__program", "plan_version__plan"
    ).prefetch_related("transitions", "admin_events__actor")
    if status:
        subscriptions = subscriptions.filter(status=status)
    if query:
        subscriptions = subscriptions.filter(
            Q(account__primary_user__email__icontains=query)
            | Q(account__primary_user__full_name__icontains=query)
            | Q(account__primary_user__username__icontains=query)
            | Q(plan_version__plan__code__icontains=query)
            | Q(id__icontains=query)
        )
    return subscriptions.order_by(
        *SUBSCRIPTION_ORDERINGS.get(sort, SUBSCRIPTION_ORDERINGS["newest"])
    )


def serialize_subscription(subscription: Subscription, *, detailed: bool = False) -> dict[str, Any]:
    user = subscription.account.primary_user
    period_end = subscription.current_period_ends_at or subscription.trial_ends_at
    remaining = None
    if period_end:
        remaining = max(0, (period_end.date() - timezone_now_date()).days)
    result: dict[str, Any] = {
        "id": subscription.id,
        "status": subscription.status,
        "plan_code": subscription.plan_version.plan.code,
        "plan_title": subscription.plan_version.title,
        "plan_version_id": subscription.plan_version_id,
        "started_at": subscription.started_at,
        "trial_ends_at": subscription.trial_ends_at,
        "current_period_started_at": subscription.current_period_started_at,
        "current_period_ends_at": subscription.current_period_ends_at,
        "grace_ends_at": subscription.grace_ends_at,
        "cancel_at_period_end": subscription.cancel_at_period_end,
        "cancellation_requested_at": subscription.cancellation_requested_at,
        "suspended_at": subscription.suspended_at,
        "ended_at": subscription.ended_at,
        "remaining_days": remaining,
        "payment_verification": subscription.payment_verification,
        "status_reason": subscription.status_reason,
        "last_payment_at": subscription.last_payment_at,
        "revision": subscription.revision,
        "user": {
            "id": user.id if user else None,
            "email": user.email if user else "",
            "full_name": user.full_name if user else "",
            "username": user.username if user else "",
            "education": {
                "program_code": user.cohort.program.code if user and user.cohort else "",
                "program_name_en": user.cohort.program.name_en if user and user.cohort else "",
                "program_name_ar": user.cohort.program.name_ar if user and user.cohort else "",
                "cohort_code": user.cohort.code if user and user.cohort else "",
                "cohort_name_en": user.cohort.name_en if user and user.cohort else "",
                "cohort_name_ar": user.cohort.name_ar if user and user.cohort else "",
            },
        },
    }
    if detailed:
        source_payment = (
            Payment.objects.filter(subscription=subscription)
            .order_by("-succeeded_at", "-created_at")
            .first()
        )
        result["source_payment"] = (
            {
                "id": source_payment.id,
                "method": source_payment.method,
                "status": source_payment.status,
                "amount_minor": source_payment.amount_minor,
                "currency": source_payment.currency,
                "currency_exponent": source_payment.currency_exponent,
            }
            if source_payment
            else None
        )
        result["transitions"] = [
            {
                "id": item.id,
                "from_status": item.from_status,
                "to_status": item.to_status,
                "source": item.source,
                "reason_code": item.reason_code,
                "effective_at": item.effective_at,
                "metadata": item.metadata,
            }
            for item in subscription.transitions.all()
        ]
        result["admin_events"] = list(
            SubscriptionAdminEvent.objects.filter(subscription=subscription)
            .select_related("actor")
            .order_by("-created_at")
        )
        result["notes"] = list(
            AdminInternalNote.objects.filter(
                target_type="subscriptions.subscription", target_id=str(subscription.id)
            )
            .select_related("author")
            .order_by("-created_at")
        )
    return result


def timezone_now_date() -> date:
    return datetime.now(UTC).date()


def serialize_user_detail(user: User) -> dict[str, Any]:
    subscriptions = list(
        Subscription.objects.filter(account__primary_user=user)
        .select_related("plan_version__plan", "account")
        .order_by("-created_at")[:25]
    )
    payments = list(
        Payment.objects.filter(account__primary_user=user)
        .select_related("account", "subscription__plan_version__plan", "price")
        .order_by("-created_at")[:25]
    )
    refunds = list(
        Refund.objects.filter(payment__account__primary_user=user).order_by("-requested_at")[:25]
    )
    focus_sessions = list(
        FocusSession.objects.filter(user=user)
        .order_by("-started_at")[:25]
        .values("id", "status", "started_at", "ended_at", "active_duration_seconds", "context_type")
    )
    attempts = list(
        Attempt.objects.filter(user=user)
        .select_related("quiz_version__quiz")
        .order_by("-created_at")[:25]
        .values("id", "status", "created_at", "completed_at", "quiz_version__quiz__id")
    )
    results = list(
        AttemptResult.objects.filter(attempt__user=user)
        .order_by("-created_at")[:25]
        .values("id", "attempt_id", "percentage", "passed", "submitted_at")
    )
    progress = list(
        LearningProgress.objects.filter(user=user)
        .select_related("learning_object")
        .order_by("-updated_at")[:25]
        .values(
            "learning_object_id",
            "learning_object__published_version__title",
            "status",
            "completion_percent",
            "updated_at",
        )
    )
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "status": user.status,
        "email_verified": user.is_email_verified,
        "preferred_language": user.preferred_language,
        "date_joined": user.date_joined,
        "cohort": {
            "id": user.cohort_id,
            "title": user.cohort.name_en if user.cohort is not None else "",
        },
        "product_roles": get_user_roles(user),
        "operational_roles": list(
            user.operational_role_assignments.select_related("role").values_list(
                "role_id", flat=True
            )
        ),
        "operational_capabilities": sorted(operational_capabilities(user)),
        "sessions": list(
            AccountSession.objects.filter(user=user)
            .order_by("-last_seen_at")
            .values("id", "device_label", "created_at", "last_seen_at", "expires_at")
        ),
        "subscriptions": [serialize_subscription(item) for item in subscriptions],
        "purchases": [serialize_purchase(item) for item in payments],
        "refunds": [
            {
                "id": item.id,
                "payment_id": item.payment_id,
                "amount_minor": item.amount_minor,
                "currency": item.currency,
                "status": item.status,
                "reason": item.reason,
                "requested_at": item.requested_at,
            }
            for item in refunds
        ],
        "learning_activity": {"progress": progress, "focus_sessions": focus_sessions},
        "assessments": {"attempts": attempts, "results": results},
        "security_events": list(
            AccountSecurityEvent.objects.filter(user=user)
            .select_related("actor")
            .order_by("-created_at")
            .values("id", "event_type", "created_at", "metadata", "actor__full_name")[:50]
        ),
        "entitlement_history": list(
            EntitlementGrant.objects.filter(user=user)
            .select_related("entitlement")
            .order_by("-granted_at")
            .values(
                "id",
                "entitlement__code",
                "source_type",
                "status",
                "starts_at",
                "ends_at",
                "granted_at",
                "revoked_at",
            )
        ),
        "audit_events": list(
            AuditRecord.objects.filter(target_type="accounts.user", target_id=str(user.id))
            .select_related("actor")
            .order_by("-occurred_at")
            .values("id", "action", "reason", "occurred_at", "actor__full_name")[:50]
        ),
        "notes": list(
            AdminInternalNote.objects.filter(target_type="accounts.user", target_id=str(user.id))
            .select_related("author")
            .order_by("-created_at")
        ),
    }


def operational_analytics(*, start: date, end: date) -> dict[str, Any]:
    """Database aggregation only; no client-derived operational metrics."""
    end_exclusive = end + timedelta(days=1)
    start_dt = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    end_dt = datetime.combine(end_exclusive, datetime.min.time(), tzinfo=UTC)
    users = User.objects.all()
    subscriptions = Subscription.objects.select_related("plan_version__plan")
    payments = Payment.objects.all()
    successful = payments.filter(
        status__in=(
            Payment.Status.SUCCEEDED,
            Payment.Status.PARTIALLY_REFUNDED,
            Payment.Status.REFUNDED,
        )
    )
    refunds = Refund.objects.filter(status=Refund.Status.SUCCEEDED)
    manual_reviews = ManualRechargeSubmission.objects.all()
    previous_start = start_dt - (end_dt - start_dt)
    live_states = (
        Subscription.Status.ACTIVE,
        Subscription.Status.TRIALING,
        Subscription.Status.GRACE,
    )
    subscription_metrics = subscriptions.aggregate(
        total=Count("id"),
        active=Count("id", filter=Q(status__in=live_states)),
        paid=Count("id", filter=Q(status=Subscription.Status.ACTIVE)),
        trial=Count("id", filter=Q(status=Subscription.Status.TRIALING)),
        expired=Count("id", filter=Q(status=Subscription.Status.EXPIRED)),
        cancelled=Count("id", filter=Q(status=Subscription.Status.CANCELLED)),
        suspended=Count("id", filter=Q(status=Subscription.Status.SUSPENDED)),
        new=Count("id", filter=Q(created_at__gte=start_dt, created_at__lt=end_dt)),
        renewals=Count(
            "id",
            filter=Q(current_period_started_at__gte=start_dt, current_period_started_at__lt=end_dt),
        ),
        previous_active=Count("id", filter=Q(created_at__lt=start_dt, status__in=live_states)),
        cancelled_period=Count(
            "id",
            filter=Q(
                status=Subscription.Status.CANCELLED,
                cancelled_at__gte=start_dt,
                cancelled_at__lt=end_dt,
            ),
        ),
        upcoming_expirations=Count(
            "id",
            filter=Q(
                current_period_ends_at__gte=end_dt,
                current_period_ends_at__lt=end_dt + timedelta(days=14),
                status__in=live_states,
            ),
        ),
    )
    previous_active = subscription_metrics["previous_active"]
    cancelled = subscription_metrics["cancelled_period"]
    revenue_metrics = successful.filter(
        succeeded_at__gte=start_dt, succeeded_at__lt=end_dt
    ).aggregate(
        gross=Sum("amount_minor"),
        count=Count("id"),
        paying_users=Count("account__primary_user_id", distinct=True),
        missing_users=Count("id", filter=Q(account__primary_user_id__isnull=True)),
    )
    gross = revenue_metrics["gross"] or 0
    refund_total = (
        refunds.filter(succeeded_at__gte=start_dt, succeeded_at__lt=end_dt).aggregate(
            value=Sum("amount_minor")
        )["value"]
        or 0
    )
    payment_count = revenue_metrics["count"]
    focus = FocusSession.objects.filter(started_at__gte=start_dt, started_at__lt=end_dt)
    attempts = Attempt.objects.filter(created_at__gte=start_dt, created_at__lt=end_dt)
    results = AttemptResult.objects.filter(created_at__gte=start_dt, created_at__lt=end_dt)
    progress = LearningProgress.objects.filter(updated_at__gte=start_dt, updated_at__lt=end_dt)
    now = datetime.now(UTC)
    recent_sessions = AccountSession.objects.filter(
        user__status=User.Status.ACTIVE,
        last_seen_at__gte=now - timedelta(minutes=5),
        expires_at__gt=now,
    )
    creators = users.filter(groups__name=Role.CREATOR.value).distinct()

    # Joining all three owned collections multiplies sheets × questions ×
    # quizzes before DISTINCT. Existence needs only one matching owned row.
    def recent_owned(model: type[LearningObject] | type[Question] | type[Quiz]) -> QuerySet[Any]:
        return model.objects.filter(
            owner_id=OuterRef("pk"), updated_at__gte=start_dt, updated_at__lt=end_dt
        )

    active_creators = creators.filter(
        Exists(recent_owned(LearningObject))
        | Exists(recent_owned(Question))
        | Exists(recent_owned(Quiz))
    )
    revenue_points = list(
        successful.filter(succeeded_at__gte=start_dt, succeeded_at__lt=end_dt)
        .annotate(day=TruncDate("succeeded_at"))
        .values("day")
        .annotate(gross_minor=Sum("amount_minor"), count=Count("id"))
        .order_by("day")
    )
    registrations = list(
        users.filter(date_joined__gte=start_dt, date_joined__lt=end_dt)
        .annotate(day=TruncDate("date_joined"))
        .values("day")
        .annotate(count=Count("id"))
        .order_by("day")
    )
    focus_activity = list(
        focus.annotate(day=TruncDate("started_at"))
        .values("day")
        .annotate(
            sessions=Count("id"),
            learners=Count("user_id", distinct=True),
            focus_seconds=Sum("active_duration_seconds"),
        )
        .order_by("day")
    )
    # These independent counters share a table and reporting window. Filtered
    # aggregates retain each metric's scope without a round trip per counter.
    user_metrics = users.aggregate(
        total=Count("id"),
        verified=Count("id", filter=Q(email_verified_at__isnull=False)),
        active_today=Count("id", filter=Q(last_login__date=end)),
        active_week=Count("id", filter=Q(last_login__gte=end_dt - timedelta(days=7))),
        active_month=Count("id", filter=Q(last_login__gte=end_dt - timedelta(days=30))),
        new_week=Count(
            "id", filter=Q(date_joined__gte=end_dt - timedelta(days=7), date_joined__lt=end_dt)
        ),
        new_registrations=Count("id", filter=Q(date_joined__gte=start_dt, date_joined__lt=end_dt)),
        suspended=Count("id", filter=Q(status=User.Status.SUSPENDED)),
        deactivated=Count("id", filter=Q(status=User.Status.DELETED)),
        returning=Count("id", filter=Q(last_login__gte=start_dt, date_joined__lt=previous_start)),
    )
    review_metrics = manual_reviews.aggregate(
        pending=Count("id", filter=Q(status=ManualRechargeSubmission.Status.PENDING)),
        approved=Count(
            "id",
            filter=Q(
                status=ManualRechargeSubmission.Status.APPROVED,
                reviewed_at__gte=start_dt,
                reviewed_at__lt=end_dt,
            ),
        ),
        rejected=Count(
            "id",
            filter=Q(
                status=ManualRechargeSubmission.Status.REJECTED,
                reviewed_at__gte=start_dt,
                reviewed_at__lt=end_dt,
            ),
        ),
        oldest_pending_at=Min(
            "submitted_at", filter=Q(status=ManualRechargeSubmission.Status.PENDING)
        ),
    )
    focus_metrics = focus.aggregate(
        active_learners=Count("user_id", distinct=True),
        focus_sessions=Count("id"),
        focus_seconds=Sum("active_duration_seconds"),
        average_focus_seconds=Avg("active_duration_seconds"),
    )
    progress_metrics = progress.aggregate(
        total=Count("id"), completed=Count("id", filter=Q(status=LearningProgress.Status.COMPLETED))
    )
    attempt_metrics = attempts.aggregate(
        total=Count("id"),
        submitted=Count(
            "id", filter=Q(status__in=(Attempt.Status.SUBMITTED, Attempt.Status.EXPIRED))
        ),
    )
    result_metrics = results.aggregate(
        total=Count("id"),
        passed=Count("id", filter=Q(passed=True)),
        average_score=Avg("percentage"),
    )
    content_metrics = LearningObject.objects.aggregate(
        published=Count("id", filter=Q(workflow_status=LearningObject.WorkflowStatus.PUBLISHED)),
        draft=Count("id", filter=Q(workflow_status=LearningObject.WorkflowStatus.DRAFT)),
        in_review=Count("id", filter=Q(workflow_status=LearningObject.WorkflowStatus.IN_REVIEW)),
    )
    return {
        "period": {"from": start, "to": end, "timezone": "UTC"},
        "users": {
            **user_metrics,
            "seen_today": AccountSession.objects.filter(
                user__status=User.Status.ACTIVE,
                last_seen_at__gte=datetime.combine(end, datetime.min.time(), tzinfo=UTC),
                last_seen_at__lt=end_dt,
            )
            .values("user_id")
            .distinct()
            .count(),
            "online_now": recent_sessions.values("user_id").distinct().count(),
            "growth": registrations,
        },
        "subscriptions": {
            **{
                key: subscription_metrics[key]
                for key in (
                    "active",
                    "trial",
                    "expired",
                    "cancelled",
                    "suspended",
                    "new",
                    "renewals",
                    "upcoming_expirations",
                )
            },
            "churn_rate": round((cancelled / previous_active) * 100, 2)
            if previous_active
            else None,
            "conversion_rate": round(
                (subscription_metrics["paid"] / max(1, subscription_metrics["total"])) * 100,
                2,
            ),
            "by_plan": list(
                subscriptions.values("plan_version__plan__code", "status")
                .annotate(count=Count("id"))
                .order_by("plan_version__plan__code", "status")
            ),
        },
        # A payments console cannot say "nothing is waiting on me" from revenue
        # totals. ``pending`` is deliberately not scoped to the reporting
        # period: a card submitted before the window still needs a decision
        # today, and a queue that empties itself when the date filter moves is
        # worse than no queue at all.
        "manual_reviews": review_metrics,
        "revenue": {
            "gross_minor": gross,
            "refund_total_minor": refund_total,
            "net_minor": gross - refund_total,
            "failed_payments": payments.filter(
                status=Payment.Status.FAILED, created_at__gte=start_dt, created_at__lt=end_dt
            ).count(),
            "average_order_minor": round(gross / payment_count, 2) if payment_count else 0,
            # The legacy DISTINCT query counts a missing primary user once.
            "paying_users": revenue_metrics["paying_users"]
            + int(bool(revenue_metrics["missing_users"])),
            "trend": revenue_points,
            "by_plan": list(
                successful.filter(succeeded_at__gte=start_dt, succeeded_at__lt=end_dt)
                .values("price_snapshot__plan_code")
                .annotate(gross_minor=Sum("amount_minor"), count=Count("id"))
                .order_by("price_snapshot__plan_code")
            ),
        },
        "learning": {
            "active_learners": focus_metrics["active_learners"],
            "material_completions": progress_metrics["completed"],
            "focus_sessions": focus_metrics["focus_sessions"],
            "focus_seconds": focus_metrics["focus_seconds"] or 0,
            "average_focus_seconds": focus_metrics["average_focus_seconds"] or 0,
            "focus_sessions_today": FocusSession.objects.filter(
                started_at__gte=datetime.combine(end, datetime.min.time(), tzinfo=UTC),
                started_at__lt=end_dt,
            ).count(),
            "focus_activity": focus_activity,
            "quiz_attempts": attempt_metrics["total"],
            "exam_attempts": attempt_metrics["submitted"],
            "completion_rate": round(
                (progress_metrics["completed"] / max(1, progress_metrics["total"])) * 100,
                2,
            ),
            "average_score": result_metrics["average_score"],
            "pass_rate": round(
                (result_metrics["passed"] / max(1, result_metrics["total"])) * 100, 2
            ),
            "most_used_materials": list(
                progress.values("learning_object_id", "learning_object__published_version__title")
                .annotate(uses=Count("id"))
                .order_by("-uses")[:10]
            ),
            "most_active_subjects": list(
                progress.exclude(
                    learning_object__published_version__academic_node__title__isnull=True
                )
                .values(
                    "learning_object__published_version__academic_node_id",
                    "learning_object__published_version__academic_node__title",
                )
                .annotate(uses=Count("id"), learners=Count("user_id", distinct=True))
                .order_by("-uses")[:6]
            ),
        },
        "creators": {
            "total": creators.count(),
            "active": active_creators.count(),
            "published_content": content_metrics["published"],
            "draft_content": content_metrics["draft"],
            "content_awaiting_review": (
                content_metrics["in_review"]
                + Question.objects.filter(workflow_status=Question.WorkflowStatus.IN_REVIEW).count()
                + Quiz.objects.filter(workflow_status=Quiz.WorkflowStatus.IN_REVIEW).count()
            ),
        },
        "operations": {
            "failed_notification_deliveries": NotificationDelivery.objects.filter(
                status=NotificationDelivery.Status.FAILED
            ).count(),
            "generated_at": datetime.now(UTC),
        },
    }


def campaigns() -> QuerySet[NotificationCampaign]:
    return NotificationCampaign.objects.select_related("created_by").all()

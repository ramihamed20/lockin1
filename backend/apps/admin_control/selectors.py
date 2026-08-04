from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from django.db.models import Avg, Count, Q, Sum
from django.db.models.functions import TruncDate

from apps.accounts.models import AccountSecurityEvent, AccountSession, User
from apps.accounts.roles import Role, get_user_roles
from apps.administration.permissions import operational_capabilities
from apps.assessments.models import Attempt, AttemptResult, Quiz
from apps.audit.models import AuditRecord
from apps.content.models import LearningObject
from apps.entitlements.models import EntitlementGrant
from apps.focus.models import FocusSession
from apps.invoices.models import Invoice
from apps.notifications.models import NotificationDelivery
from apps.payments.models import Payment
from apps.progress.models import LearningProgress
from apps.questions.models import Question
from apps.refunds.models import Refund
from apps.subscriptions.models import Subscription
from apps.provider_integrations.models import ProviderObjectLink

from .models import AdminInternalNote, NotificationCampaign, PaymentStatusCorrection, SubscriptionAdminEvent


def admin_purchases(*, query: str = "", status: str = ""):
    payments = Payment.objects.select_related(
        "account__primary_user", "subscription__plan_version__plan", "price"
    ).prefetch_related("transitions", "refunds__transitions", "invoice__lines", "invoice__transitions")
    if status:
        payments = payments.filter(status=status)
    if query:
        payments = payments.filter(
            Q(id__icontains=query)
            | Q(account__primary_user__email__icontains=query)
            | Q(account__primary_user__full_name__icontains=query)
            | Q(invoice__number__icontains=query)
            | Q(price__plan_version__plan__code__icontains=query)
        )
    return payments.order_by("-created_at", "-id")


def serialize_purchase(payment: Payment, *, detailed: bool = False) -> dict[str, Any]:
    user = payment.account.primary_user
    payload: dict[str, Any] = {
        "id": payment.id,
        "status": payment.status,
        "amount_minor": payment.amount_minor,
        "currency": payment.currency,
        "currency_exponent": payment.currency_exponent,
        "refunded_amount_minor": payment.refunded_amount_minor,
        "transaction_id": str(payment.id),
        "created_at": payment.created_at,
        "initiated_at": payment.initiated_at,
        "succeeded_at": payment.succeeded_at,
        "failure_code": payment.failure_code,
        "plan_code": payment.price_snapshot.get("plan_code", ""),
        "plan_title": payment.price_snapshot.get("plan_title", ""),
        "user": {
            "id": user.id if user else None,
            "email": user.email if user else "",
            "full_name": user.full_name if user else "",
        },
        "invoice_id": str(payment.invoice.id) if hasattr(payment, "invoice") else None,
        "invoice_number": payment.invoice.number if hasattr(payment, "invoice") else "",
    }
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
                AdminInternalNote.objects.filter(target_type="payments.payment", target_id=str(payment.id))
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
    return payload


def admin_subscriptions(*, query: str = "", status: str = "", missing_only: bool = False):
    users = User.objects.select_related().all()
    if missing_only:
        users = users.exclude(subscription_accounts__subscriptions__isnull=False)
        if query:
            users = users.filter(Q(email__icontains=query) | Q(full_name__icontains=query))
        return users.order_by("-date_joined")
    subscriptions = Subscription.objects.select_related(
        "account__primary_user", "plan_version__plan"
    ).prefetch_related("transitions", "admin_events__actor")
    if status:
        subscriptions = subscriptions.filter(status=status)
    if query:
        subscriptions = subscriptions.filter(
            Q(account__primary_user__email__icontains=query)
            | Q(account__primary_user__full_name__icontains=query)
            | Q(plan_version__plan__code__icontains=query)
            | Q(id__icontains=query)
        )
    return subscriptions.order_by("-created_at", "-id")


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
        "revision": subscription.revision,
        "user": {
            "id": user.id if user else None,
            "email": user.email if user else "",
            "full_name": user.full_name if user else "",
        },
    }
    if detailed:
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
    refunds = list(Refund.objects.filter(payment__account__primary_user=user).order_by("-requested_at")[:25])
    focus_sessions = list(
        FocusSession.objects.filter(user=user).order_by("-started_at")[:25].values(
            "id", "status", "started_at", "ended_at", "active_duration_seconds", "context_type"
        )
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
        .values("learning_object_id", "learning_object__published_version__title", "status", "completion_percent", "updated_at")
    )
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "status": user.status,
        "email_verified": user.is_email_verified,
        "preferred_language": user.preferred_language,
        "date_joined": user.date_joined,
        "product_roles": get_user_roles(user),
        "operational_roles": list(
            user.operational_role_assignments.select_related("role").values_list("role_id", flat=True)
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
    successful = payments.filter(status__in=(Payment.Status.SUCCEEDED, Payment.Status.PARTIALLY_REFUNDED, Payment.Status.REFUNDED))
    refunds = Refund.objects.filter(status=Refund.Status.SUCCEEDED)
    active_subscriptions = subscriptions.filter(
        status__in=(Subscription.Status.ACTIVE, Subscription.Status.TRIALING, Subscription.Status.GRACE)
    )
    previous_start = start_dt - (end_dt - start_dt)
    current_new = subscriptions.filter(created_at__gte=start_dt, created_at__lt=end_dt)
    previous_active = subscriptions.filter(
        created_at__lt=start_dt,
        status__in=(Subscription.Status.ACTIVE, Subscription.Status.TRIALING, Subscription.Status.GRACE),
    ).count()
    cancelled = subscriptions.filter(status=Subscription.Status.CANCELLED, cancelled_at__gte=start_dt, cancelled_at__lt=end_dt).count()
    gross = successful.filter(succeeded_at__gte=start_dt, succeeded_at__lt=end_dt).aggregate(value=Sum("amount_minor"))["value"] or 0
    refund_total = refunds.filter(succeeded_at__gte=start_dt, succeeded_at__lt=end_dt).aggregate(value=Sum("amount_minor"))["value"] or 0
    payment_count = successful.filter(succeeded_at__gte=start_dt, succeeded_at__lt=end_dt).count()
    focus = FocusSession.objects.filter(started_at__gte=start_dt, started_at__lt=end_dt)
    attempts = Attempt.objects.filter(created_at__gte=start_dt, created_at__lt=end_dt)
    submitted = attempts.filter(status__in=(Attempt.Status.SUBMITTED, Attempt.Status.EXPIRED))
    results = AttemptResult.objects.filter(created_at__gte=start_dt, created_at__lt=end_dt)
    progress = LearningProgress.objects.filter(updated_at__gte=start_dt, updated_at__lt=end_dt)
    creators = users.filter(groups__name=Role.CREATOR.value).distinct()
    active_creators = creators.filter(
        Q(owned_learning_objects__updated_at__gte=start_dt, owned_learning_objects__updated_at__lt=end_dt)
        | Q(owned_questions__updated_at__gte=start_dt, owned_questions__updated_at__lt=end_dt)
        | Q(owned_quizzes__updated_at__gte=start_dt, owned_quizzes__updated_at__lt=end_dt)
    ).distinct()
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
    return {
        "period": {"from": start, "to": end, "timezone": "UTC"},
        "users": {
            "total": users.count(),
            "verified": users.filter(email_verified_at__isnull=False).count(),
            "active_today": users.filter(last_login__date=end).count(),
            "active_week": users.filter(last_login__gte=end_dt - timedelta(days=7)).count(),
            "active_month": users.filter(last_login__gte=end_dt - timedelta(days=30)).count(),
            "new_registrations": users.filter(date_joined__gte=start_dt, date_joined__lt=end_dt).count(),
            "suspended": users.filter(status=User.Status.SUSPENDED).count(),
            "deactivated": users.filter(status=User.Status.DELETED).count(),
            "returning": users.filter(last_login__gte=start_dt, date_joined__lt=previous_start).count(),
            "growth": registrations,
        },
        "subscriptions": {
            "active": active_subscriptions.count(),
            "trial": subscriptions.filter(status=Subscription.Status.TRIALING).count(),
            "expired": subscriptions.filter(status=Subscription.Status.EXPIRED).count(),
            "cancelled": subscriptions.filter(status=Subscription.Status.CANCELLED).count(),
            "suspended": subscriptions.filter(status=Subscription.Status.SUSPENDED).count(),
            "new": current_new.count(),
            "renewals": subscriptions.filter(current_period_started_at__gte=start_dt, current_period_started_at__lt=end_dt).count(),
            "churn_rate": round((cancelled / previous_active) * 100, 2) if previous_active else None,
            "conversion_rate": round((subscriptions.filter(status=Subscription.Status.ACTIVE).count() / max(1, subscriptions.count())) * 100, 2),
            "by_plan": list(
                subscriptions.values("plan_version__plan__code", "status")
                .annotate(count=Count("id"))
                .order_by("plan_version__plan__code", "status")
            ),
            "upcoming_expirations": subscriptions.filter(
                current_period_ends_at__gte=end_dt,
                current_period_ends_at__lt=end_dt + timedelta(days=14),
                status__in=(Subscription.Status.ACTIVE, Subscription.Status.TRIALING, Subscription.Status.GRACE),
            ).count(),
        },
        "revenue": {
            "gross_minor": gross,
            "refund_total_minor": refund_total,
            "net_minor": gross - refund_total,
            "failed_payments": payments.filter(status=Payment.Status.FAILED, created_at__gte=start_dt, created_at__lt=end_dt).count(),
            "average_order_minor": round(gross / payment_count, 2) if payment_count else 0,
            "paying_users": successful.filter(succeeded_at__gte=start_dt, succeeded_at__lt=end_dt).values("account__primary_user_id").distinct().count(),
            "trend": revenue_points,
            "by_plan": list(
                successful.filter(succeeded_at__gte=start_dt, succeeded_at__lt=end_dt)
                .values("price_snapshot__plan_code")
                .annotate(gross_minor=Sum("amount_minor"), count=Count("id"))
                .order_by("price_snapshot__plan_code")
            ),
        },
        "learning": {
            "active_learners": focus.values("user_id").distinct().count(),
            "material_completions": progress.filter(status=LearningProgress.Status.COMPLETED).count(),
            "focus_sessions": focus.count(),
            "focus_seconds": focus.aggregate(value=Sum("active_duration_seconds"))["value"] or 0,
            "average_focus_seconds": focus.aggregate(value=Avg("active_duration_seconds"))["value"] or 0,
            "quiz_attempts": attempts.count(),
            "exam_attempts": submitted.count(),
            "completion_rate": round((progress.filter(status=LearningProgress.Status.COMPLETED).count() / max(1, progress.count())) * 100, 2),
            "average_score": results.aggregate(value=Avg("percentage"))["value"],
            "pass_rate": round((results.filter(passed=True).count() / max(1, results.count())) * 100, 2),
            "most_used_materials": list(
                progress.values("learning_object_id", "learning_object__published_version__title")
                .annotate(uses=Count("id"))
                .order_by("-uses")[:10]
            ),
        },
        "creators": {
            "total": creators.count(),
            "active": active_creators.count(),
            "published_content": LearningObject.objects.filter(
                workflow_status=LearningObject.WorkflowStatus.PUBLISHED
            ).count(),
            "draft_content": LearningObject.objects.filter(
                workflow_status=LearningObject.WorkflowStatus.DRAFT
            ).count(),
            "content_awaiting_review": (
                LearningObject.objects.filter(workflow_status=LearningObject.WorkflowStatus.IN_REVIEW).count()
                + Question.objects.filter(workflow_status=Question.WorkflowStatus.IN_REVIEW).count()
                + Quiz.objects.filter(workflow_status=Quiz.WorkflowStatus.IN_REVIEW).count()
            ),
        },
        "operations": {
            "failed_notification_deliveries": NotificationDelivery.objects.filter(status=NotificationDelivery.Status.FAILED).count(),
            "generated_at": datetime.now(UTC),
        },
    }


def campaigns():
    return NotificationCampaign.objects.select_related("created_by").all()

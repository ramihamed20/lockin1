from collections import Counter
from datetime import datetime, timedelta
from shutil import disk_usage
from tempfile import gettempdir
from typing import Any
from unicodedata import normalize

from django.db.models import Count, Exists, OuterRef, Q, QuerySet
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.roles import Role
from apps.admin_control.models import NotificationCampaign
from apps.content.models import CatalogDocument, CatalogSubject
from apps.entitlements.models import EntitlementGrant, PlanEntitlementRule
from apps.feedback.models import FeedbackSuggestion
from apps.moderation.models import Report
from apps.notifications.models import NotificationDelivery
from apps.payments.models import ManualRechargeSubmission, Payment
from apps.subscriptions.models import Subscription, SubscriptionAccount
from platform_core.observability.health import collect_health_status

from .models import AutomationJob

LIMIT = 25
LIVE = (Subscription.Status.ACTIVE, Subscription.Status.TRIALING, Subscription.Status.GRACE)


def examples(rows: QuerySet[Any], **fields: str) -> dict[str, Any]:
    return {
        "count": rows.count(),
        "examples": [
            {key: str(value) for key, value in zip(fields, row, strict=True) if value is not None}
            for row in rows.order_by("pk").values_list(*fields.values())[:LIMIT]
        ],
    }


def student_checks() -> dict[str, Any]:
    now = timezone.now()
    students = User.objects.filter(is_superuser=False).exclude(
        groups__name__in=(Role.ADMINISTRATOR.value, Role.CREATOR.value, Role.MODERATOR.value)
    )
    entitled = EntitlementGrant.objects.filter(
        user_id=OuterRef("pk"),
        status=EntitlementGrant.Status.ACTIVE,
        starts_at__lte=now,
    ).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))
    return {
        "inactive_accounts_with_live_grants": examples(
            students.exclude(status=User.Status.ACTIVE).filter(Exists(entitled)), id="pk"
        ),
        "verified_students_without_cohort": examples(
            students.filter(
                status=User.Status.ACTIVE, email_verified_at__isnull=False, cohort__isnull=True
            ),
            id="pk",
        ),
    }


def missing_subscription_grants(now: datetime) -> QuerySet[Subscription]:
    effective = EntitlementGrant.objects.filter(
        source_type=EntitlementGrant.SourceType.SUBSCRIPTION,
        source_id=OuterRef(OuterRef("pk")),
        user_id=OuterRef(OuterRef("account__primary_user_id")),
        entitlement_id=OuterRef("entitlement_id"),
        status=EntitlementGrant.Status.ACTIVE,
        starts_at__lte=now,
    ).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))
    missing_rule = PlanEntitlementRule.objects.filter(
        plan_version_id=OuterRef("plan_version_id")
    ).filter(~Exists(effective))
    return (
        Subscription.objects.filter(
            status__in=LIVE,
            account__kind=SubscriptionAccount.Kind.INDIVIDUAL,
            account__status=SubscriptionAccount.Status.ACTIVE,
            payment_verification=Subscription.PaymentVerification.VERIFIED,
        )
        .filter(
            Q(status=Subscription.Status.ACTIVE, current_period_ends_at__gt=now)
            | Q(
                status=Subscription.Status.ACTIVE, cancel_at_period_end=False, grace_ends_at__gt=now
            )
            | Q(status=Subscription.Status.TRIALING, trial_ends_at__gt=now)
            | Q(status=Subscription.Status.GRACE, grace_ends_at__gt=now)
        )
        .filter(Exists(missing_rule))
    )


def subscription_checks() -> dict[str, Any]:
    now = timezone.now()
    upcoming = Subscription.objects.filter(
        Q(
            status=Subscription.Status.ACTIVE,
            current_period_ends_at__range=(now, now + timedelta(days=14)),
        )
        | Q(
            status=Subscription.Status.TRIALING,
            trial_ends_at__range=(now, now + timedelta(days=14)),
        )
        | Q(status=Subscription.Status.GRACE, grace_ends_at__range=(now, now + timedelta(days=14)))
    )
    incomplete = Subscription.objects.filter(
        Q(status=Subscription.Status.ACTIVE, current_period_ends_at__isnull=True)
        | Q(status=Subscription.Status.TRIALING, trial_ends_at__isnull=True)
        | Q(status=Subscription.Status.GRACE, grace_ends_at__isnull=True)
    )
    return {
        "expiring_within_14_days": examples(upcoming, id="pk", status="status"),
        "incomplete_access_windows": examples(incomplete, id="pk", status="status"),
        "missing_plan_grants": examples(missing_subscription_grants(now), id="pk"),
        "provisional_payment_reviews": examples(
            Subscription.objects.filter(
                status__in=LIVE, payment_verification=Subscription.PaymentVerification.PROVISIONAL
            ),
            id="pk",
        ),
        "scheduled_nonrenewals": examples(upcoming.filter(cancel_at_period_end=True), id="pk"),
    }


def payment_checks() -> dict[str, Any]:
    now = timezone.now()
    pending = ManualRechargeSubmission.objects.filter(
        status=ManualRechargeSubmission.Status.PENDING
    )
    duplicate = ManualRechargeSubmission.objects.filter(
        recharge_code_digest=OuterRef("recharge_code_digest")
    ).exclude(pk=OuterRef("pk"))
    approved = ManualRechargeSubmission.objects.filter(
        status=ManualRechargeSubmission.Status.APPROVED,
        subscription_period_ends_at__gt=now,
    )
    return {
        "pending_manual_reviews": examples(pending, id="payment_id"),
        "pending_with_matching_submission": examples(
            pending.exclude(recharge_code_digest="").filter(Exists(duplicate)), id="payment_id"
        ),
        "approved_with_missing_plan_grants": examples(
            approved.filter(payment__subscription__in=missing_subscription_grants(now)),
            id="payment_id",
        ),
        "approved_payment_status_discrepancies": examples(
            approved.exclude(
                payment__status__in=(
                    Payment.Status.SUCCEEDED,
                    Payment.Status.PARTIALLY_REFUNDED,
                    Payment.Status.REFUNDED,
                )
            ),
            id="payment_id",
        ),
    }


def notification_checks() -> dict[str, Any]:
    since = timezone.now() - timedelta(days=14)
    return {
        "failed_deliveries_last_14_days": NotificationDelivery.objects.filter(
            status=NotificationDelivery.Status.FAILED, created_at__gte=since
        ).count(),
        "campaigns_with_failures": examples(
            NotificationCampaign.objects.filter(failed_count__gt=0, updated_at__gte=since),
            id="pk",
            failures="failed_count",
        ),
        "drafts_waiting_for_operator": examples(
            NotificationCampaign.objects.filter(status=NotificationCampaign.Status.DRAFT), id="pk"
        ),
    }


def feedback_checks() -> dict[str, Any]:
    rows = FeedbackSuggestion.objects.filter(
        status=FeedbackSuggestion.Status.NEW, created_at__gte=timezone.now() - timedelta(days=30)
    )
    groups: Counter[tuple[str, str]] = Counter()
    sample = list(rows.values_list("category", "message")[:250])
    for category, message in sample:
        groups[category, " ".join(normalize("NFKC", message).casefold().split())] += 1
    return {
        "new_suggestions_last_30_days": rows.count(),
        "analyzed_suggestions": len(sample),
        "by_category": dict(rows.order_by().values_list("category").annotate(count=Count("id"))),
        "recurring_requests": [
            {"category": category, "matching_suggestions": count}
            for (category, _), count in groups.most_common(10)
            if count > 1
        ],
    }


def moderation_checks() -> dict[str, Any]:
    reports = Report.objects.filter(
        status__in=(Report.Status.OPEN, Report.Status.TRIAGED, Report.Status.IN_PROGRESS),
        private_space_id__isnull=True,
    )
    return {
        "pending_by_reason": dict(
            reports.order_by().values_list("reason").annotate(count=Count("id"))
        ),
        "urgent_reports": examples(
            reports.filter(priority=Report.Priority.URGENT), id="pk", reason="reason"
        ),
    }


def analytics_checks() -> dict[str, Any]:
    now = timezone.now()
    current, previous = now - timedelta(days=7), now - timedelta(days=14)
    published = CatalogDocument.objects.filter(
        material_slug=OuterRef("material_slug"), is_active=True
    )
    missing = CatalogSubject.objects.filter(is_active=True).filter(~Exists(published))
    failed = Payment.objects.filter(status=Payment.Status.FAILED)
    latest = failed.filter(failed_at__gte=current).count()
    baseline = failed.filter(failed_at__gte=previous, failed_at__lt=current).count()
    return {
        "subjects_without_published_material": examples(missing, id="pk"),
        "failed_payments_last_7_days": latest,
        "failed_payments_previous_7_days": baseline,
        "payment_failure_spike": latest >= max(5, 2 * baseline),
    }


def system_checks() -> dict[str, Any]:
    now = timezone.now()
    health = collect_health_status()
    jobs = AutomationJob.objects
    queued = jobs.filter(status=AutomationJob.Status.QUEUED)
    disk = disk_usage(gettempdir())
    return {
        "application_health": health["status"],
        "queued_jobs": queued.count(),
        "queued_over_10_minutes": queued.filter(
            created_at__lte=now - timedelta(minutes=10)
        ).count(),
        "failed_or_blocked_jobs": jobs.filter(
            status__in=(AutomationJob.Status.FAILED, AutomationJob.Status.BLOCKED)
        ).count(),
        "expired_worker_leases": jobs.filter(
            status=AutomationJob.Status.PREPARING, lease_expires_at__lte=now
        ).count(),
        "worker_temp_free_mib": disk.free // (1024 * 1024),
        "worker_temp_below_500_mib": disk.free < 500 * 1024 * 1024,
    }


CHECKS = {
    "student_checks": ("Student access checks", "users.view", "users", student_checks),
    "subscription_checks": (
        "Subscription checks",
        "subscriptions.view",
        "subscriptions",
        subscription_checks,
    ),
    "payment_checks": (
        "Payment reconciliation checks",
        "payments.view",
        "purchases",
        payment_checks,
    ),
    "notification_checks": (
        "Notification delivery checks",
        "notifications.view",
        "notifications",
        notification_checks,
    ),
    "feedback_checks": ("Feedback trends", "moderation.view", "feedback", feedback_checks),
    "moderation_checks": (
        "Moderation queue checks",
        "moderation.view",
        "reports",
        moderation_checks,
    ),
    "analytics_checks": ("Operational anomalies", "analytics.view", "analytics", analytics_checks),
    "system_checks": (
        "Automation and system health",
        "system_health.view",
        "system",
        system_checks,
    ),
}

from datetime import UTC, datetime, timedelta
from typing import Any

from django.db.models import Count, Q, QuerySet, Sum

from apps.accounts.models import User
from apps.accounts.roles import get_user_roles
from apps.achievements.models import AchievementDefinition
from apps.analytics.catalog import Metric
from apps.analytics.models import AnalyticsFact, DailyMetric
from apps.assessments.models import Quiz
from apps.content.models import LearningObject
from apps.education.models import EducationNode
from apps.moderation.models import Report
from apps.notifications.models import NotificationDelivery
from apps.payments.models import Payment
from apps.questions.models import Question
from apps.subscriptions.models import Subscription
from platform_core.observability.health import collect_health_status

from .catalog import Capability
from .models import OperationalRoleAssignment
from .permissions import has_operational_capability, operational_capabilities


def _status_counts(queryset, field: str = "status") -> dict[str, int]:  # type: ignore[no-untyped-def]
    return {
        str(row[field]): row["count"]
        for row in queryset.values(field).annotate(count=Count("id")).order_by(field)
    }


def operations_session(*, user: User) -> dict[str, Any]:
    capabilities = operational_capabilities(user)
    roles = tuple(
        OperationalRoleAssignment.objects.filter(user=user)
        .order_by("role_id")
        .values_list("role_id", flat=True)
    )
    dashboards = [
        item
        for item, capability in (
            ("overview", Capability.OVERVIEW_VIEW),
            ("content", Capability.CONTENT_VIEW),
            ("support", Capability.USERS_VIEW),
        )
        if capability in capabilities
    ]
    return {
        "roles": roles,
        "capabilities": sorted(capabilities),
        "dashboards": dashboards,
        "timezone": "UTC",
    }


def operational_resource_catalog(*, user: User) -> list[dict[str, str]]:
    resources = (
        ("users", "User management", "/operations/users", Capability.USERS_VIEW),
        ("education", "Educational hierarchy", "/admin/education", Capability.CONTENT_VIEW),
        ("content", "Content studio", "/management/content", Capability.CONTENT_VIEW),
        (
            "assessments",
            "Assessment studio",
            "/management/assessments",
            Capability.ASSESSMENTS_VIEW,
        ),
        ("community", "Learning community", "/community", Capability.COMMUNITY_VIEW),
        ("moderation", "Moderation queue", "/moderation", Capability.MODERATION_VIEW),
        (
            "subscriptions",
            "Subscription health",
            "/operations/support",
            Capability.SUBSCRIPTIONS_VIEW,
        ),
        ("payments", "Payment operations", "/operations/support", Capability.PAYMENTS_VIEW),
        ("achievements", "Achievement engine", "/operations/content", Capability.ACHIEVEMENTS_VIEW),
        (
            "notifications",
            "Notification operations",
            "/operations/support",
            Capability.NOTIFICATIONS_VIEW,
        ),
        ("analytics", "Learning analytics", "/operations", Capability.ANALYTICS_VIEW),
        ("audit", "Audit history", "/operations/audit", Capability.AUDIT_VIEW),
        ("reports", "Operational reports", "/operations/reports", Capability.REPORTS_EXPORT),
        (
            "configuration",
            "System configuration",
            "/operations/configuration",
            Capability.CONFIGURATION_VIEW,
        ),
        ("system_health", "System health", "/operations", Capability.SYSTEM_HEALTH_VIEW),
    )
    return [
        {"code": code, "label": label, "path": path}
        for code, label, path, capability in resources
        if has_operational_capability(user, capability)
    ]


def overview_dashboard(*, user: User, days: int) -> dict[str, Any]:
    today = datetime.now(UTC).date()
    start = today - timedelta(days=days - 1)
    metric_rows = (
        DailyMetric.objects.filter(day__gte=start, day__lte=today)
        .values("metric")
        .annotate(total=Sum("value"))
    )
    metric_totals = {row["metric"]: row["total"] for row in metric_rows}
    subscription_counts = _status_counts(Subscription.objects.all())
    queue_counts = {
        "moderation": Report.objects.filter(
            status__in=(Report.Status.OPEN, Report.Status.TRIAGED, Report.Status.IN_PROGRESS)
        ).count(),
        "failed_payments": Payment.objects.filter(status=Payment.Status.FAILED).count(),
        "failed_notifications": NotificationDelivery.objects.filter(
            status=NotificationDelivery.Status.FAILED
        ).count(),
    }
    freshness = (
        AnalyticsFact.objects.order_by("-recorded_at").values_list("recorded_at", flat=True).first()
    )
    return {
        "generated_at": datetime.now(UTC),
        "period": {"from": start, "to": today, "timezone": "UTC"},
        "analytics_freshness": freshness,
        "metrics": metric_totals,
        "subscriptions": subscription_counts,
        "queues": queue_counts,
        "resources": operational_resource_catalog(user=user),
    }


def content_dashboard() -> dict[str, Any]:
    return {
        "generated_at": datetime.now(UTC),
        "education": _status_counts(EducationNode.objects.all()),
        "learning_objects": _status_counts(LearningObject.objects.all(), "workflow_status"),
        "questions": _status_counts(Question.objects.all(), "workflow_status"),
        "quizzes": _status_counts(Quiz.objects.all(), "workflow_status"),
        "achievement_definitions": AchievementDefinition.objects.count(),
        "quality": {
            "open_question_reports": Report.objects.filter(
                target_type__in=(
                    Report.TargetType.QUESTION,
                    Report.TargetType.ANSWER,
                    Report.TargetType.EXPLANATION,
                ),
                status__in=(Report.Status.OPEN, Report.Status.TRIAGED, Report.Status.IN_PROGRESS),
            ).count()
        },
    }


def support_dashboard(*, days: int) -> dict[str, Any]:
    today = datetime.now(UTC).date()
    start = today - timedelta(days=days - 1)
    recent_contributions = (
        DailyMetric.objects.filter(
            day__gte=start,
            day__lte=today,
            metric=Metric.COMMUNITY_CONTRIBUTIONS,
        ).aggregate(total=Sum("value"))["total"]
        or 0
    )
    return {
        "generated_at": datetime.now(UTC),
        "accounts": User.objects.aggregate(
            total=Count("id"),
            suspended=Count("id", filter=Q(status=User.Status.SUSPENDED)),
            unverified=Count("id", filter=Q(email_verified_at__isnull=True)),
        ),
        "moderation": _status_counts(Report.objects.all()),
        "payments": _status_counts(Payment.objects.all()),
        "subscriptions": _status_counts(Subscription.objects.all()),
        "notifications": {
            "failed_deliveries": NotificationDelivery.objects.filter(
                status=NotificationDelivery.Status.FAILED
            ).count(),
        },
        "community": {"recent_contributions": recent_contributions},
    }


def system_health_dashboard() -> dict[str, Any]:
    return collect_health_status()


def operational_users(
    *, query: str = "", status: str = "", role: str = "", ordering: str = "-date_joined"
) -> QuerySet[User]:
    users = (
        User.objects.select_related("cohort")
        .prefetch_related("groups", "operational_role_assignments__role")
        .all()
    )
    if query:
        users = users.filter(Q(email__istartswith=query) | Q(full_name__istartswith=query))
    if status in User.Status.values:
        users = users.filter(status=status)
    if role:
        users = users.filter(groups__name=role)
    safe_ordering = (
        ordering
        if ordering in {"date_joined", "-date_joined", "full_name", "email"}
        else "-date_joined"
    )
    return users.distinct().order_by(safe_ordering)


def serialize_operational_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "status": user.status,
        "email_verified": user.is_email_verified,
        "product_roles": get_user_roles(user),
        "operational_roles": sorted(
            assignment.role_id for assignment in user.operational_role_assignments.all()
        ),
        "date_joined": user.date_joined,
        "cohort": {
            "id": user.cohort_id,
            "title": user.cohort.name_en if user.cohort is not None else "",
        },
    }

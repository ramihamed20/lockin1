from dataclasses import dataclass

from apps.administration.catalog import Capability


@dataclass(frozen=True, slots=True)
class ReportDefinition:
    code: str
    name: str
    description: str
    capability: str
    columns: tuple[str, ...]
    filter_names: frozenset[str]
    schedule_ready: bool


REPORTS = {
    item.code: item
    for item in (
        ReportDefinition(
            code="analytics_daily",
            name="Daily learning analytics",
            description="Daily event-driven projections with freshness metadata.",
            capability=Capability.ANALYTICS_VIEW,
            columns=("day", "metric", "value", "dimensions"),
            filter_names=frozenset({"from", "to"}),
            schedule_ready=True,
        ),
        ReportDefinition(
            code="user_directory",
            name="User directory",
            description="Bounded operational account directory for support workflows.",
            capability=Capability.USERS_VIEW,
            columns=("id", "email", "full_name", "status", "date_joined"),
            filter_names=frozenset({"status"}),
            schedule_ready=False,
        ),
        ReportDefinition(
            code="moderation_queue",
            name="Moderation queue",
            description="Open and in-review learning safety reports.",
            capability=Capability.MODERATION_VIEW,
            columns=("id", "reason", "status", "target_type", "target_id", "created_at"),
            filter_names=frozenset(),
            schedule_ready=True,
        ),
        ReportDefinition(
            code="purchase_records",
            name="Purchases and refunds",
            description="Provider-verified payment records with safe administrative fields.",
            capability=Capability.PAYMENTS_VIEW,
            columns=(
                "id",
                "status",
                "amount_minor",
                "currency",
                "refunded_amount_minor",
                "account__primary_user__email",
                "created_at",
                "succeeded_at",
            ),
            filter_names=frozenset({"status", "from", "to"}),
            schedule_ready=True,
        ),
        ReportDefinition(
            code="subscription_records",
            name="Subscriptions",
            description="Subscription lifecycle records with plan and account data.",
            capability=Capability.SUBSCRIPTIONS_VIEW,
            columns=(
                "id",
                "status",
                "plan_version__plan__code",
                "account__primary_user__email",
                "started_at",
                "current_period_ends_at",
                "cancel_at_period_end",
                "created_at",
            ),
            filter_names=frozenset({"status", "from", "to"}),
            schedule_ready=True,
        ),
        ReportDefinition(
            code="focus_activity",
            name="Focus activity",
            description="Server-recorded Focus sessions and active duration.",
            capability=Capability.ANALYTICS_VIEW,
            columns=(
                "id",
                "user__email",
                "context_type",
                "status",
                "started_at",
                "ended_at",
                "active_duration_seconds",
            ),
            filter_names=frozenset({"from", "to"}),
            schedule_ready=True,
        ),
        ReportDefinition(
            code="assessment_attempts",
            name="Assessment attempts",
            description="Submitted server assessment attempts, without answer content.",
            capability=Capability.ASSESSMENTS_VIEW,
            columns=(
                "id",
                "user__email",
                "status",
                "created_at",
                "completed_at",
                "quiz_version__quiz__id",
            ),
            filter_names=frozenset({"from", "to", "status"}),
            schedule_ready=True,
        ),
        ReportDefinition(
            code="audit_log",
            name="Administrative audit log",
            description="Immutable administrative audit events without secret fields.",
            capability=Capability.AUDIT_VIEW,
            columns=(
                "id",
                "actor__email",
                "action",
                "domain",
                "target_type",
                "target_id",
                "reason",
                "occurred_at",
            ),
            filter_names=frozenset({"from", "to", "domain"}),
            schedule_ready=True,
        ),
    )
}

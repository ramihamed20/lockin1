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
    )
}

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class ConfigurationDefinition:
    key: str
    name: str
    description: str
    value_type: str
    default: Any
    minimum: int | None = None
    maximum: int | None = None


DEFINITIONS = {
    item.key: item
    for item in (
        ConfigurationDefinition(
            key="analytics.default_window_days",
            name="Default analytics window",
            description="Default number of UTC calendar days shown in operational trends.",
            value_type="integer",
            default=14,
            minimum=1,
            maximum=90,
        ),
        ConfigurationDefinition(
            key="reporting.max_export_rows",
            name="Maximum export rows",
            description="Hard row limit for synchronous operational CSV exports.",
            value_type="integer",
            default=5000,
            minimum=100,
            maximum=10000,
        ),
        ConfigurationDefinition(
            key="operations.max_action_targets",
            name="Maximum action targets",
            description="Hard target limit for a single confirmed operational action.",
            value_type="integer",
            default=100,
            minimum=1,
            maximum=250,
        ),
        ConfigurationDefinition(
            key="operations.preview_ttl_seconds",
            name="Preview confirmation lifetime",
            description="Seconds before an action or report confirmation expires.",
            value_type="integer",
            default=900,
            minimum=300,
            maximum=3600,
        ),
        ConfigurationDefinition(
            key="platform.maintenance_mode",
            name="Maintenance mode",
            description="Signals a planned maintenance window to the application shell. API enforcement is deployed separately.",
            value_type="boolean",
            default=False,
        ),
        ConfigurationDefinition(
            key="registration.enabled",
            name="Registration availability",
            description="Controls whether new public account registrations are accepted.",
            value_type="boolean",
            default=True,
        ),
        ConfigurationDefinition(
            key="feature.focus_workspace_enabled",
            name="Focus Workspace availability",
            description="Controls availability messaging for the Focus Workspace; entitlement enforcement remains server-authoritative.",
            value_type="boolean",
            default=True,
        ),
        ConfigurationDefinition(
            key="uploads.max_file_size_mb",
            name="Upload size limit",
            description="Operational user-interface limit for managed uploads in megabytes.",
            value_type="integer",
            default=50,
            minimum=1,
            maximum=500,
        ),
        ConfigurationDefinition(
            key="pagination.default_page_size",
            name="Default pagination size",
            description="Default operational list page size for compatible client requests.",
            value_type="integer",
            default=25,
            minimum=10,
            maximum=100,
        ),
        ConfigurationDefinition(
            key="sessions.default_duration_seconds",
            name="Default session duration",
            description="Documented default duration for new standard browser sessions in seconds.",
            value_type="integer",
            default=43200,
            minimum=900,
            maximum=2592000,
        ),
        ConfigurationDefinition(
            key="platform.branding_name",
            name="Platform branding name",
            description="Plain-text platform name used in operational notification templates.",
            value_type="string",
            default="Lock-in",
        ),
        ConfigurationDefinition(
            key="notifications.default_template_prefix",
            name="Notification template prefix",
            description="Plain-text default prefix for administrator-created notifications.",
            value_type="string",
            default="Lock-in update",
        ),
        ConfigurationDefinition(
            key="notifications.max_campaign_recipients",
            name="Maximum notification campaign recipients",
            description="Hard recipient limit for a synchronous campaign dispatch when no background worker is configured.",
            value_type="integer",
            default=5000,
            minimum=1,
            maximum=10000,
        ),
    )
}

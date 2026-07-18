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
    )
}

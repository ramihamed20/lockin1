from dataclasses import dataclass
from datetime import date
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class StreakUpdated(DomainEvent):
    event_name = "streaks.updated"

    user_id: UUID
    current_days: int
    longest_days: int
    last_qualified_on: date
    source_key: str

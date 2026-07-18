from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class AchievementEarned(DomainEvent):
    event_name = "achievements.earned"

    earned_id: UUID
    user_id: UUID
    definition_code: str
    title: str
    earned_at: datetime

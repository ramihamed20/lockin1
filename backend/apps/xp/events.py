from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class XpAwarded(DomainEvent):
    event_name = "xp.awarded"

    transaction_id: UUID
    user_id: UUID
    points: int
    category: str
    ranking_eligible: bool
    source_key: str
    awarded_at: datetime

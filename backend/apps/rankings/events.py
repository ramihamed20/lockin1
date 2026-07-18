from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class RankingSnapshotPublished(DomainEvent):
    event_name = "rankings.snapshot_published"

    snapshot_id: UUID
    definition_code: str
    participant_count: int
    published_at: datetime

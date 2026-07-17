from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class ModerationReportCreated(DomainEvent):
    event_name = "moderation.report.created"

    report_id: UUID
    reporter_id: UUID
    target_type: str
    target_id: UUID
    reason: str


@dataclass(frozen=True, slots=True, kw_only=True)
class ModeratorActionRecorded(DomainEvent):
    event_name = "moderation.action.recorded"

    report_id: UUID | None
    action_id: UUID
    action: str
    target_type: str
    target_id: UUID
    reporter_id: UUID | None
    target_author_id: UUID | None

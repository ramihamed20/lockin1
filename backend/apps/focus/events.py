from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class FocusSessionStarted(DomainEvent):
    event_name = "focus.session_started"
    session_id: UUID
    user_id: UUID
    context_type: str
    context_id: UUID | None


@dataclass(frozen=True, slots=True, kw_only=True)
class FocusSessionCompleted(DomainEvent):
    event_name = "focus.session_completed"
    session_id: UUID
    user_id: UUID
    context_type: str
    context_id: UUID | None
    active_duration_seconds: int


@dataclass(frozen=True, slots=True, kw_only=True)
class FocusSessionPaused(DomainEvent):
    event_name = "focus.session_paused"
    session_id: UUID
    user_id: UUID
    context_type: str
    context_id: UUID | None


@dataclass(frozen=True, slots=True, kw_only=True)
class FocusSessionResumed(DomainEvent):
    event_name = "focus.session_resumed"
    session_id: UUID
    user_id: UUID
    context_type: str
    context_id: UUID | None


@dataclass(frozen=True, slots=True, kw_only=True)
class FocusSessionAbandoned(DomainEvent):
    event_name = "focus.session_abandoned"
    session_id: UUID
    user_id: UUID
    context_type: str
    context_id: UUID | None
    active_duration_seconds: int

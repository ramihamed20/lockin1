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


@dataclass(frozen=True, slots=True, kw_only=True)
class ActiveStudyExamPassed(DomainEvent):
    """A reader passed a managed Active Study checkpoint or final exam.

    Active Study is the product's guided study flow, and passing one of its
    exams is the clearest evidence of a study day there is. It was already
    rewarded with XP but reached neither the streak nor the achievement
    ledger, so a reader could finish a sheet every day and still be told their
    streak was zero.
    """

    event_name = "focus.active_study_exam_passed"
    run_id: UUID
    attempt_id: UUID
    user_id: UUID
    sheet_id: UUID
    difficulty: str
    kind: str
    score: int
    total: int
    run_completed: bool

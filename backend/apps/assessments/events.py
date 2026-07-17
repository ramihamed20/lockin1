from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class QuizPublished(DomainEvent):
    event_name = "quiz.published"

    quiz_id: UUID
    version_id: UUID
    academic_node_id: UUID
    mode: str


@dataclass(frozen=True, slots=True, kw_only=True)
class QuizAttemptStarted(DomainEvent):
    event_name = "quiz.attempt.started"

    attempt_id: UUID
    user_id: UUID
    quiz_id: UUID
    quiz_version_id: UUID
    mode: str


@dataclass(frozen=True, slots=True, kw_only=True)
class QuizAttemptAutosaved(DomainEvent):
    event_name = "quiz.attempt.autosaved"

    attempt_id: UUID
    attempt_question_id: UUID
    user_id: UUID
    client_revision: int
    server_revision: int


@dataclass(frozen=True, slots=True, kw_only=True)
class QuizAttemptSubmitted(DomainEvent):
    event_name = "quiz.attempt.submitted"

    attempt_id: UUID
    result_id: UUID
    user_id: UUID
    quiz_id: UUID
    quiz_version_id: UUID
    mode: str
    percentage: str
    passed: bool
    ranking_eligible: bool
    achievement_eligible: bool


@dataclass(frozen=True, slots=True, kw_only=True)
class AssessmentReportCreated(DomainEvent):
    event_name = "assessment.report.created"

    report_id: UUID
    result_id: UUID
    attempt_question_id: UUID
    reporter_id: UUID
    category: str

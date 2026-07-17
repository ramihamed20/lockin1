from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class QuestionPublished(DomainEvent):
    event_name = "question.published"

    question_id: UUID
    version_id: UUID
    academic_node_id: UUID

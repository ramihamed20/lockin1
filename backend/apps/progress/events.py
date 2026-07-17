from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class LessonCompleted(DomainEvent):
    event_name = "education.lesson_completed"
    lesson_id: UUID
    user_id: UUID

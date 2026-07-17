from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class ContentPublished(DomainEvent):
    event_name = "content.content_published"
    learning_object_id: UUID
    version_id: UUID
    academic_node_id: UUID
    content_type: str

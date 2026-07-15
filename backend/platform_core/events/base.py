from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import ClassVar
from uuid import UUID, uuid4


@dataclass(frozen=True, slots=True, kw_only=True)
class DomainEvent:
    """Immutable fact emitted by a domain after an authoritative state change."""

    event_name: ClassVar[str] = "domain.event"
    schema_version: ClassVar[int] = 1

    event_id: UUID = field(default_factory=uuid4)
    occurred_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    correlation_id: UUID | None = None
    causation_id: UUID | None = None
    actor_id: UUID | None = None

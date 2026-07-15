from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class UserRegistered(DomainEvent):
    event_name = "accounts.user_registered"
    user_id: UUID

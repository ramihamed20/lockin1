from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class PlanPublished(DomainEvent):
    event_name = "catalog.plan_published"
    plan_id: UUID
    plan_version_id: UUID


@dataclass(frozen=True, slots=True, kw_only=True)
class PricePublished(DomainEvent):
    event_name = "catalog.price_published"
    price_id: UUID
    plan_version_id: UUID

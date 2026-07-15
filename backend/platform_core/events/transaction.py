from django.db import transaction

from .base import DomainEvent
from .bus import InProcessEventBus, domain_events


def publish_after_commit(event: DomainEvent, *, bus: InProcessEventBus = domain_events) -> None:
    transaction.on_commit(lambda: bus.publish(event))

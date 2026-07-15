import logging
from collections import defaultdict
from collections.abc import Callable
from threading import RLock

from .base import DomainEvent

logger = logging.getLogger(__name__)
EventHandler = Callable[[DomainEvent], None]


class EventDispatchError(RuntimeError):
    pass


class InProcessEventBus:
    """Small synchronous event dispatcher for the modular monolith.

    It is intentionally not a durable queue. Production dispatch defaults to isolation so a
    subscriber cannot undo an already committed domain transaction. Tests may enable strict mode.
    """

    def __init__(self, *, strict: bool = False) -> None:
        self._strict = strict
        self._handlers: defaultdict[type[DomainEvent], list[EventHandler]] = defaultdict(list)
        self._lock = RLock()

    def subscribe(self, event_type: type[DomainEvent], handler: EventHandler) -> Callable[[], None]:
        with self._lock:
            self._handlers[event_type].append(handler)

        def unsubscribe() -> None:
            with self._lock:
                handlers = self._handlers[event_type]
                if handler in handlers:
                    handlers.remove(handler)

        return unsubscribe

    def publish(self, event: DomainEvent) -> None:
        with self._lock:
            handlers = list(self._handlers[type(event)])
            if type(event) is not DomainEvent:
                handlers.extend(self._handlers[DomainEvent])

        for handler in handlers:
            try:
                handler(event)
            except Exception as error:  # noqa: BLE001 - handlers are an isolation boundary
                logger.exception(
                    "Domain event subscriber failed",
                    extra={"event_name": event.event_name, "event_id": str(event.event_id)},
                )
                if self._strict:
                    raise EventDispatchError(
                        f"Subscriber failed for {event.event_name}."
                    ) from error


domain_events = InProcessEventBus()

import logging
from collections import defaultdict
from collections.abc import Callable
from threading import RLock
from typing import TypeVar, cast

from .base import DomainEvent

logger = logging.getLogger(__name__)
EventHandler = Callable[[DomainEvent], None]
EventType = TypeVar("EventType", bound=DomainEvent)


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

    def subscribe(
        self, event_type: type[EventType], handler: Callable[[EventType], None]
    ) -> Callable[[], None]:
        stored_handler = cast(EventHandler, handler)
        with self._lock:
            self._handlers[event_type].append(stored_handler)

        def unsubscribe() -> None:
            with self._lock:
                handlers = self._handlers[event_type]
                if stored_handler in handlers:
                    handlers.remove(stored_handler)

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
                # Isolation is not the same as silence. A swallowed subscriber
                # is invisible in a log nobody is tailing, and this bus carries
                # work that users feel -- notifications, projections, repair
                # passes. Report it where failures are actually watched.
                #
                # Anything a request must not lose is called directly by the
                # service that owns it rather than left to this path; see
                # apps.subscriptions.services._converge_entitlements.
                self._report_failure(event=event, error=error)
                if self._strict:
                    raise EventDispatchError(
                        f"Subscriber failed for {event.event_name}."
                    ) from error

    @staticmethod
    def _report_failure(*, event: DomainEvent, error: Exception) -> None:
        # Imported lazily: observability configures itself from settings, and the
        # bus is constructed at import time.
        from platform_core.observability import providers

        try:
            providers.metric_sink.increment(
                "events.subscriber.failed", attributes={"event": event.event_name}
            )
            providers.error_reporter.capture_exception(
                error,
                context={"event_name": event.event_name, "event_id": str(event.event_id)},
            )
        except Exception:  # noqa: BLE001 - reporting must never mask the original failure
            logger.exception("Could not report a failed domain event subscriber")


domain_events = InProcessEventBus()

from dataclasses import dataclass

import pytest

from platform_core.events import DomainEvent, EventDispatchError, InProcessEventBus


@dataclass(frozen=True, slots=True, kw_only=True)
class ExampleEvent(DomainEvent):
    event_name = "test.example"
    value: str


def test_event_bus_dispatches_specific_and_global_handlers() -> None:
    bus = InProcessEventBus(strict=True)
    received: list[str] = []
    bus.subscribe(ExampleEvent, lambda event: received.append(f"specific:{event.event_name}"))
    unsubscribe = bus.subscribe(
        DomainEvent, lambda event: received.append(f"global:{event.event_name}")
    )

    bus.publish(ExampleEvent(value="ok"))
    unsubscribe()
    bus.publish(ExampleEvent(value="again"))

    assert received == ["specific:test.example", "global:test.example", "specific:test.example"]


def test_strict_event_bus_surfaces_subscriber_failure() -> None:
    bus = InProcessEventBus(strict=True)

    def fail(_: DomainEvent) -> None:
        raise RuntimeError("subscriber failed")

    bus.subscribe(ExampleEvent, fail)

    with pytest.raises(EventDispatchError):
        bus.publish(ExampleEvent(value="ok"))


def test_non_strict_event_bus_isolates_subscriber_failure(caplog: pytest.LogCaptureFixture) -> None:
    bus = InProcessEventBus()
    received: list[str] = []

    def fail(_: DomainEvent) -> None:
        raise RuntimeError("subscriber failed")

    bus.subscribe(ExampleEvent, fail)
    bus.subscribe(ExampleEvent, lambda event: received.append(event.event_name))

    bus.publish(ExampleEvent(value="ok"))

    assert received == ["test.example"]
    assert "Domain event subscriber failed" in caplog.text

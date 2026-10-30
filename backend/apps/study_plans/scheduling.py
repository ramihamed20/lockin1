"""Pure deterministic scheduling preview.

Inputs must already be authorized and version-anchored. Capacity is net of
breaks/buffer, dates are local to the student. Units are atomic, remaining work.
This earliest-deadline-first heuristic is deterministic, not an optimal solver.
It does not persist, infer mastery, complete activities, or award XP.
"""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class WorkUnit:
    key: str
    minutes: int
    earliest: date
    deadline: date
    priority: int = 0
    requires: tuple[str, ...] = ()
    category: str = ""
    subject: str = ""


@dataclass(frozen=True)
class DayCapacity:
    day: date
    minutes: int


@dataclass(frozen=True)
class FixedWork:
    key: str
    day: date
    minutes: int


@dataclass(frozen=True)
class Assignment:
    key: str
    day: date
    minutes: int


@dataclass(frozen=True)
class Unscheduled:
    key: str
    minutes: int
    reason: str


@dataclass(frozen=True)
class DayLoad:
    day: date
    available: int
    fixed: int
    allocated: int
    remaining: int
    overflow: int


@dataclass(frozen=True)
class SchedulePreview:
    assignments: tuple[Assignment, ...]
    unscheduled: tuple[Unscheduled, ...]
    days: tuple[DayLoad, ...]


def _minutes(value: int, *, allow_zero: bool = False) -> None:
    if type(value) is not int or not (0 if allow_zero else 1) <= value <= 480:
        raise ValueError("Minutes must be integers within the daily safety limit.")


def build_schedule_preview(
    units: tuple[WorkUnit, ...],
    capacities: tuple[DayCapacity, ...],
    fixed: tuple[FixedWork, ...] = (),
    completed_keys: frozenset[str] = frozenset(),
    *,
    balanced: bool = False,
) -> SchedulePreview:
    """Preserve fixed work; explain every unplaced unit.

    Completed keys exclude new work only: time spent on a planning day must
    also be reserved in fixed. Keys identify activities, not bare sheets.
    Priority is caller policy, not a scientifically validated score.
    """
    if not capacities or len(capacities) > 366 or len(units) + len(fixed) > 10_000:
        raise ValueError("Provide a bounded, non-empty planning horizon.")
    days = sorted(capacities, key=lambda item: item.day)
    dates = {item.day for item in days}
    if len(dates) != len(days):
        raise ValueError("Capacity dates must be unique.")
    for item in days:
        _minutes(item.minutes, allow_zero=True)
    keys = [item.key for item in units] + [item.key for item in fixed]
    if any(not key.strip() for key in keys) or len(set(keys)) != len(keys):
        raise ValueError("Activity keys must be non-empty and unique across inputs.")
    for unit in units:
        _minutes(unit.minutes)
        if unit.earliest > unit.deadline or type(unit.priority) is not int:
            raise ValueError("Invalid activity window or priority.")
    known = {unit.key for unit in units} | completed_keys
    for unit in units:
        if unit.key in unit.requires or any(key not in known for key in unit.requires):
            raise ValueError("Prerequisites must identify other input or completed activities.")
    reserved_minutes = dict.fromkeys(dates, 0)
    reserved_counts = dict.fromkeys(dates, 0)
    for reservation in fixed:
        _minutes(reservation.minutes)
        if reservation.day not in dates:
            raise ValueError("Fixed work must be inside the horizon.")
        reserved_minutes[reservation.day] += reservation.minutes
        reserved_counts[reservation.day] += 1
    pending = sorted(
        (unit for unit in units if unit.key not in completed_keys),
        key=lambda unit: (unit.deadline, -unit.priority, unit.key),
    )
    finished = set(completed_keys)
    assignments: list[Assignment] = []
    loads: list[DayLoad] = []
    category_load: dict[str, int] = {}
    subject_load: dict[str, int] = {}
    weights = {"reading": 0.55, "active_study": 0.25, "review": 0.20}
    for capacity in days:
        reserved = reserved_minutes[capacity.day]
        remaining = max(0, capacity.minutes - reserved)
        slots = max(0, 48 - reserved_counts[capacity.day])
        allocated = 0
        if balanced:
            while slots:
                choices = [
                    unit
                    for unit in pending
                    if unit.earliest <= capacity.day <= unit.deadline
                    and unit.minutes <= remaining
                    and all(key in finished for key in unit.requires)
                ]
                if not choices:
                    break
                # Earliest exam remains authoritative; within that deadline,
                # balance accumulated time rather than reserve all reviews first.
                unit = min(
                    choices,
                    key=lambda unit: (
                        unit.deadline,
                        category_load.get(unit.category, 0) / weights.get(unit.category, 1),
                        subject_load.get(unit.subject, 0),
                        -unit.priority,
                        unit.key,
                    ),
                )
                assignments.append(Assignment(unit.key, capacity.day, unit.minutes))
                finished.add(unit.key)
                remaining -= unit.minutes
                allocated += unit.minutes
                slots -= 1
                category_load[unit.category] = category_load.get(unit.category, 0) + unit.minutes
                subject_load[unit.subject] = subject_load.get(unit.subject, 0) + unit.minutes
                pending.remove(unit)
        else:
            unplaced: list[WorkUnit] = []
            for unit in pending:
                if (
                    slots
                    and unit.earliest <= capacity.day <= unit.deadline
                    and unit.minutes <= remaining
                    and all(key in finished for key in unit.requires)
                ):
                    assignments.append(Assignment(unit.key, capacity.day, unit.minutes))
                    finished.add(unit.key)
                    remaining -= unit.minutes
                    allocated += unit.minutes
                    slots -= 1
                else:
                    unplaced.append(unit)
            pending = unplaced
        loads.append(
            DayLoad(
                capacity.day,
                capacity.minutes,
                reserved,
                allocated,
                remaining,
                max(0, reserved - capacity.minutes),
            )
        )
    unscheduled = tuple(
        Unscheduled(
            unit.key,
            unit.minutes,
            "deadline_before_horizon"
            if unit.deadline < days[0].day
            else "outside_horizon"
            if unit.earliest > days[-1].day
            else "no_fitting_slot",
        )
        for unit in pending
    )
    return SchedulePreview(tuple(assignments), unscheduled, tuple(loads))

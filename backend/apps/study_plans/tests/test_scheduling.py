from datetime import date, timedelta
from random import Random

import pytest

from ..scheduling import DayCapacity, FixedWork, WorkUnit, build_schedule_preview

TODAY = date(2026, 10, 25)
TOMORROW = TODAY + timedelta(days=1)


def work(key, minutes=25, earliest=TODAY, deadline=TOMORROW, priority=0):
    return WorkUnit(key, minutes, earliest, deadline, priority)


def test_completed_time_and_fixed_work_do_not_free_fictitious_capacity():
    result = build_schedule_preview(
        (work("done"), work("new")),
        (DayCapacity(TODAY, 60),),
        (FixedWork("done-reservation", TODAY, 45),),
        frozenset({"done"}),
    )
    assert result.assignments == ()
    assert [item.key for item in result.unscheduled] == ["new"]
    assert result.days[0].remaining == 15


def test_deadline_precedes_priority():
    result = build_schedule_preview(
        (work("later", priority=100), work("urgent", deadline=TODAY)),
        (DayCapacity(TODAY, 25), DayCapacity(TOMORROW, 25)),
    )
    assert [(item.key, item.day) for item in result.assignments] == [
        ("urgent", TODAY),
        ("later", TOMORROW),
    ]
    assert result.unscheduled == ()


def test_priority_and_identity_break_ties_deterministically_without_mutating_inputs():
    units = (work("b"), work("a"), work("review", priority=1))
    capacity = (DayCapacity(TODAY, 50),)
    result = build_schedule_preview(units, capacity)
    assert [item.key for item in result.assignments] == ["review", "a"]
    assert [item.key for item in result.unscheduled] == ["b"]
    assert result == build_schedule_preview(tuple(reversed(units)), capacity)
    assert units[0].key == "b"


def test_rest_and_overbooked_fixed_work_are_preserved():
    fixed = (FixedWork("manual", TODAY, 70),)
    result = build_schedule_preview(
        (work("new"),), (DayCapacity(TODAY, 60), DayCapacity(TOMORROW, 0)), fixed
    )
    assert result.assignments == ()
    assert result.days[0].overflow == 10
    assert result.days[0].fixed == 70
    assert result.days[1].allocated == 0
    assert fixed[0].day == TODAY


def test_expired_and_future_work_are_explained_not_silently_moved():
    result = build_schedule_preview(
        (
            work("expired", earliest=TODAY - timedelta(days=2), deadline=TODAY - timedelta(days=1)),
            work("future", earliest=TOMORROW),
            work("large", minutes=61),
        ),
        (DayCapacity(TODAY, 60),),
    )
    assert {item.key: item.reason for item in result.unscheduled} == {
        "expired": "deadline_before_horizon",
        "future": "outside_horizon",
        "large": "no_fitting_slot",
    }
    assert result.assignments == ()


def test_time_after_exam_cannot_hide_shortfall():
    result = build_schedule_preview(
        (work("exam", minutes=30, deadline=TODAY),),
        (DayCapacity(TODAY, 20), DayCapacity(TOMORROW, 100)),
    )
    assert result.assignments == ()
    assert result.unscheduled[0].minutes == 30


def test_fixed_sessions_consume_safety_limit():
    fixed = tuple(FixedWork(str(i), TODAY, 5) for i in range(48))
    result = build_schedule_preview((work("new", minutes=5),), (DayCapacity(TODAY, 480),), fixed)
    assert result.assignments == ()
    assert result.days[0].remaining == 240


@pytest.mark.parametrize("minutes", [-1, 481, 2.5, True])
def test_invalid_capacity(minutes):
    with pytest.raises(ValueError):
        build_schedule_preview((), (DayCapacity(TODAY, minutes),))


def test_duplicate_ids_and_dates_are_rejected():
    with pytest.raises(ValueError):
        build_schedule_preview((work("same"), work("same")), (DayCapacity(TODAY, 60),))
    with pytest.raises(ValueError):
        build_schedule_preview(
            (work("same"),), (DayCapacity(TODAY, 60),), (FixedWork("same", TODAY, 5),)
        )
    with pytest.raises(ValueError):
        build_schedule_preview((), (DayCapacity(TODAY, 60), DayCapacity(TODAY, 60)))


def test_generated_scenarios_conserve_all_work_and_respect_capacity_and_deadlines():
    random = Random(42)  # noqa: S311 -- reproducible workload simulation, not security
    for _ in range(100):
        capacities = tuple(
            DayCapacity(TODAY + timedelta(days=i), random.randrange(0, 121)) for i in range(7)
        )
        units = tuple(
            work(
                str(i),
                minutes=random.randrange(5, 91),
                deadline=TODAY + timedelta(days=random.randrange(7)),
            )
            for i in range(30)
        )
        result = build_schedule_preview(units, capacities)
        by_key = {unit.key: unit for unit in units}
        assigned = {item.key for item in result.assignments}
        unassigned = {item.key for item in result.unscheduled}
        assert not assigned & unassigned
        assert assigned | unassigned == set(by_key)
        assert len(assigned) == len(result.assignments)
        assert sum(item.minutes for item in result.assignments + result.unscheduled) == sum(
            unit.minutes for unit in units
        )
        for item in result.assignments:
            assert by_key[item.key].earliest <= item.day <= by_key[item.key].deadline
        for day in result.days:
            assert day.allocated <= day.available
            assert day.remaining + day.allocated == day.available


def test_later_pages_cannot_jump_over_an_unscheduled_prerequisite():
    first = work("first", minutes=25)
    last = WorkUnit("last", 10, TODAY, TOMORROW, requires=("first",))
    result = build_schedule_preview(
        (first, last), (DayCapacity(TODAY, 10), DayCapacity(TOMORROW, 35))
    )
    assert [(item.key, item.day) for item in result.assignments] == [
        ("first", TOMORROW),
        ("last", TOMORROW),
    ]
    assert result.unscheduled == ()


def test_unknown_prerequisite_is_rejected():
    with pytest.raises(ValueError):
        build_schedule_preview(
            (WorkUnit("new", 10, TODAY, TOMORROW, requires=("missing",)),),
            (DayCapacity(TODAY, 60),),
        )

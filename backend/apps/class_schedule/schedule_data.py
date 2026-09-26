"""The university timetable behind "My Group", transcribed from the faculty's sheets.

This module is source data, not logic. Every practical cell below is copied from
the published Set A and Set B practical timetables; nothing is rotated, derived
or inferred. A practical group name (for example ``C1``) exists in both sets and
means a different schedule in each, so every practical session is keyed by the
pair ``(schedule_set, practical_group)`` and never by the group name alone.

Course codes, halls and lab names are intentionally absent: the student-facing
timetable shows only the subject.
"""

from dataclasses import dataclass
from typing import Literal

TheoryGroup = Literal["A", "B"]
PracticalGroup = Literal["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2"]
Day = Literal["sunday", "monday", "tuesday", "wednesday", "thursday"]
SessionKind = Literal["theory", "practical"]

THEORY_GROUPS: tuple[TheoryGroup, ...] = ("A", "B")
PRACTICAL_GROUPS: tuple[PracticalGroup, ...] = ("A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2")
DAYS: tuple[Day, ...] = ("sunday", "monday", "tuesday", "wednesday", "thursday")
TIME_SLOTS: tuple[tuple[str, str], ...] = (
    ("08:00", "10:00"),
    ("10:00", "12:00"),
    ("12:00", "14:00"),
    ("14:00", "16:00"),
)

GENERAL_PATHOLOGY = "general_pathology"
MICROBIOLOGY = "microbiology"
PHARMACOLOGY = "pharmacology"
ORAL_HISTOLOGY = "oral_histology"
CONSERVATIVE_ENDODONTICS_1 = "conservative_endodontics_1"
FIXED_PROSTHODONTICS_1 = "fixed_prosthodontics_1"
REMOVABLE_PROSTHODONTICS_1 = "removable_prosthodontics_1"

SUBJECTS: tuple[str, ...] = (
    GENERAL_PATHOLOGY,
    MICROBIOLOGY,
    PHARMACOLOGY,
    ORAL_HISTOLOGY,
    CONSERVATIVE_ENDODONTICS_1,
    FIXED_PROSTHODONTICS_1,
    REMOVABLE_PROSTHODONTICS_1,
)


@dataclass(frozen=True)
class TheorySession:
    theory_group: TheoryGroup
    day: Day
    start_time: str
    end_time: str
    subject: str


@dataclass(frozen=True)
class PracticalSession:
    schedule_set: TheoryGroup
    practical_group: PracticalGroup
    day: Day
    start_time: str
    end_time: str
    subject: str


_GP, _MB, _PH, _OH = GENERAL_PATHOLOGY, MICROBIOLOGY, PHARMACOLOGY, ORAL_HISTOLOGY
_CE, _FP, _RP = CONSERVATIVE_ENDODONTICS_1, FIXED_PROSTHODONTICS_1, REMOVABLE_PROSTHODONTICS_1
_NONE = None

THEORY_SESSIONS: tuple[TheorySession, ...] = (
    TheorySession("A", "sunday", "08:00", "10:00", _GP),
    TheorySession("A", "sunday", "10:00", "12:00", _FP),
    TheorySession("A", "monday", "08:00", "10:00", _MB),
    TheorySession("A", "monday", "10:00", "12:00", _OH),
    TheorySession("A", "tuesday", "08:00", "10:00", _PH),
    TheorySession("A", "wednesday", "08:00", "10:00", _CE),
    TheorySession("A", "thursday", "08:00", "10:00", _RP),
    TheorySession("B", "sunday", "12:00", "14:00", _PH),
    TheorySession("B", "monday", "12:00", "14:00", _CE),
    TheorySession("B", "tuesday", "12:00", "14:00", _RP),
    TheorySession("B", "wednesday", "10:00", "12:00", _GP),
    TheorySession("B", "wednesday", "12:00", "14:00", _FP),
    TheorySession("B", "thursday", "10:00", "12:00", _MB),
    TheorySession("B", "thursday", "12:00", "14:00", _OH),
)

# One row per published timetable row. The eight cells follow PRACTICAL_GROUPS:
#                                          A1    A2    B1    B2    C1    C2    D1    D2
_PracticalRow = tuple[Day, str, str, tuple[str | None, ...]]

_SET_A_ROWS: tuple[_PracticalRow, ...] = (
    ("sunday", "12:00", "14:00", (_OH, _FP, _RP, _CE, _PH, _MB, _GP, _NONE)),
    ("monday", "12:00", "14:00", (_FP, _NONE, _CE, _MB, _RP, _OH, _PH, _GP)),
    ("tuesday", "10:00", "12:00", (_NONE,) * 8),
    ("tuesday", "12:00", "14:00", (_PH, _GP, _OH, _NONE, _CE, _RP, _FP, _MB)),
    ("tuesday", "14:00", "16:00", (_MB, _OH, _GP, _PH, _NONE, _FP, _RP, _CE)),
    ("wednesday", "10:00", "12:00", (_RP, _PH, _MB, _GP, _OH, _NONE, _CE, _FP)),
    ("wednesday", "12:00", "14:00", (_CE, _MB, _PH, _OH, _FP, _GP, _NONE, _RP)),
    ("thursday", "10:00", "12:00", (_NONE, _CE, _FP, _RP, _GP, _PH, _MB, _OH)),
    ("thursday", "12:00", "14:00", (_GP, _RP, _NONE, _FP, _MB, _CE, _OH, _PH)),
)

_SET_B_ROWS: tuple[_PracticalRow, ...] = (
    ("sunday", "08:00", "10:00", (_OH, _FP, _RP, _CE, _PH, _MB, _GP, _NONE)),
    ("sunday", "10:00", "12:00", (_NONE, _CE, _FP, _RP, _GP, _PH, _MB, _OH)),
    ("sunday", "12:00", "14:00", (_NONE,) * 8),
    ("monday", "08:00", "10:00", (_FP, _NONE, _CE, _MB, _RP, _OH, _PH, _GP)),
    ("monday", "10:00", "12:00", (_GP, _RP, _NONE, _FP, _MB, _CE, _OH, _PH)),
    ("monday", "12:00", "14:00", (_NONE,) * 8),
    ("tuesday", "08:00", "10:00", (_PH, _GP, _OH, _NONE, _CE, _RP, _FP, _MB)),
    ("tuesday", "10:00", "12:00", (_MB, _OH, _GP, _PH, _NONE, _FP, _RP, _CE)),
    ("tuesday", "12:00", "14:00", (_NONE,) * 8),
    ("wednesday", "08:00", "10:00", (_RP, _PH, _MB, _GP, _OH, _NONE, _CE, _FP)),
    ("wednesday", "10:00", "12:00", (_NONE,) * 8),
    ("wednesday", "12:00", "14:00", (_NONE,) * 8),
    ("thursday", "08:00", "10:00", (_CE, _MB, _PH, _OH, _FP, _GP, _NONE, _RP)),
    ("thursday", "10:00", "12:00", (_NONE,) * 8),
    ("thursday", "12:00", "14:00", (_NONE,) * 8),
)


def _expand(schedule_set: TheoryGroup, rows: tuple[_PracticalRow, ...]) -> list[PracticalSession]:
    sessions: list[PracticalSession] = []
    for day, start, end, cells in rows:
        for group, subject in zip(PRACTICAL_GROUPS, cells, strict=True):
            if subject is not None:
                sessions.append(PracticalSession(schedule_set, group, day, start, end, subject))
    return sessions


PRACTICAL_SESSIONS: tuple[PracticalSession, ...] = (
    *_expand("A", _SET_A_ROWS),
    *_expand("B", _SET_B_ROWS),
)

"""University of Tripoli, Dentistry, Year 1: the timetable behind "My Group".

Source data, not logic. Every session below is copied from the faculty's Year 1
timetable exactly as supplied; nothing is rotated, derived or inferred. It is
kept apart from ``schedule_data`` (Year 2) on purpose: the two years share no
sessions, and a Year 1 choice can never resolve against Year 2 data.

Year 1 groups in two levels. A theory group (A or B) has its own four practical
groups (A-D), and a practical group name means a different schedule under each
theory group, so every practical session is keyed by the pair
``(theory_group, practical_group)`` and never by the practical name alone.

The general anatomy lecture of theory group A runs 09:00-12:00. The official
sheet draws it across adjacent cells; it is one continuous lecture and is stored
as one session.
"""

from dataclasses import dataclass
from typing import Literal

TheoryGroup = Literal["A", "B"]
PracticalGroup = Literal["A", "B", "C", "D"]
Day = Literal["sunday", "monday", "tuesday", "wednesday", "thursday"]

THEORY_GROUPS: tuple[TheoryGroup, ...] = ("A", "B")
PRACTICAL_GROUPS: tuple[PracticalGroup, ...] = ("A", "B", "C", "D")
DAYS: tuple[Day, ...] = ("sunday", "monday", "tuesday", "wednesday", "thursday")
TIME_SLOTS: tuple[tuple[str, str], ...] = (
    ("08:00", "10:00"),
    ("10:00", "12:00"),
    ("12:00", "14:00"),
    ("14:00", "16:00"),
)

GENERAL_ANATOMY = "general_anatomy"
HISTOLOGY = "histology"
PHYSIOLOGY = "physiology"
BIOCHEMISTRY = "biochemistry"
DENTAL_MATERIALS = "dental_materials"
DENTAL_ANATOMY = "dental_anatomy"

SUBJECTS: tuple[str, ...] = (
    GENERAL_ANATOMY,
    HISTOLOGY,
    PHYSIOLOGY,
    BIOCHEMISTRY,
    DENTAL_MATERIALS,
    DENTAL_ANATOMY,
)

COURSE_CODES: dict[str, str] = {
    GENERAL_ANATOMY: "MS110",
    HISTOLOGY: "MS120",
    PHYSIOLOGY: "MS130",
    BIOCHEMISTRY: "MS140",
    DENTAL_MATERIALS: "DS110",
    DENTAL_ANATOMY: "DS120",
}
_SUBJECT_BY_CODE = {code: subject for subject, code in COURSE_CODES.items()}


@dataclass(frozen=True)
class TheorySession:
    theory_group: TheoryGroup
    day: Day
    start_time: str
    end_time: str
    subject: str


@dataclass(frozen=True)
class PracticalSession:
    theory_group: TheoryGroup
    practical_group: PracticalGroup
    day: Day
    start_time: str
    end_time: str
    subject: str


def _theory(group: TheoryGroup, day: Day, start: str, end: str, code: str) -> TheorySession:
    return TheorySession(group, day, start, end, _SUBJECT_BY_CODE[code])


THEORY_SESSIONS: tuple[TheorySession, ...] = (
    # Theory group A
    _theory("A", "sunday", "10:00", "12:00", "MS120"),
    _theory("A", "monday", "08:00", "10:00", "DS120"),
    _theory("A", "monday", "10:00", "12:00", "MS140"),
    _theory("A", "monday", "14:00", "16:00", "DS110"),
    _theory("A", "tuesday", "09:00", "12:00", "MS110"),
    _theory("A", "wednesday", "08:00", "10:00", "MS130"),
    _theory("A", "thursday", "08:00", "10:00", "DS110"),
    _theory("A", "thursday", "10:00", "12:00", "DS120"),
    # Theory group B (the corrected sheet)
    _theory("B", "sunday", "12:00", "14:00", "MS110"),
    _theory("B", "sunday", "14:00", "16:00", "DS110"),
    _theory("B", "monday", "12:00", "14:00", "DS120"),
    _theory("B", "tuesday", "12:00", "14:00", "MS130"),
    _theory("B", "tuesday", "14:00", "16:00", "MS120"),
    _theory("B", "wednesday", "10:00", "12:00", "MS110"),
    _theory("B", "wednesday", "12:00", "14:00", "DS110"),
    _theory("B", "thursday", "12:00", "14:00", "MS140"),
    _theory("B", "thursday", "14:00", "16:00", "DS120"),
)

# (day, start, end, course code) per practical group, as published.
_PracticalCell = tuple[Day, str, str, str]

_PRACTICAL: dict[tuple[TheoryGroup, PracticalGroup], tuple[_PracticalCell, ...]] = {
    ("A", "A"): (
        ("sunday", "12:00", "14:00", "MS120"),
        ("sunday", "14:00", "16:00", "DS120"),
        ("monday", "12:00", "14:00", "DS120"),
        ("tuesday", "12:00", "14:00", "MS140"),
        ("tuesday", "14:00", "16:00", "MS110"),
        ("wednesday", "10:00", "12:00", "DS110"),
        ("wednesday", "12:00", "14:00", "MS130"),
        ("thursday", "12:00", "14:00", "DS110"),
    ),
    ("A", "B"): (
        ("sunday", "12:00", "14:00", "MS110"),
        ("sunday", "14:00", "16:00", "MS140"),
        ("monday", "12:00", "14:00", "DS110"),
        ("tuesday", "12:00", "14:00", "MS130"),
        ("tuesday", "14:00", "16:00", "DS120"),
        ("wednesday", "10:00", "12:00", "DS120"),
        ("wednesday", "12:00", "14:00", "DS110"),
        ("thursday", "12:00", "14:00", "MS120"),
    ),
    ("A", "C"): (
        ("sunday", "12:00", "14:00", "DS120"),
        ("sunday", "14:00", "16:00", "DS110"),
        ("monday", "12:00", "14:00", "MS110"),
        ("tuesday", "12:00", "14:00", "DS110"),
        ("tuesday", "14:00", "16:00", "MS130"),
        ("wednesday", "10:00", "12:00", "MS120"),
        ("wednesday", "12:00", "14:00", "MS140"),
        ("thursday", "12:00", "14:00", "DS120"),
    ),
    ("A", "D"): (
        ("sunday", "12:00", "14:00", "DS110"),
        ("sunday", "14:00", "16:00", "MS130"),
        ("monday", "12:00", "14:00", "MS120"),
        ("tuesday", "12:00", "14:00", "DS120"),
        ("tuesday", "14:00", "16:00", "DS110"),
        ("wednesday", "10:00", "12:00", "MS140"),
        ("wednesday", "12:00", "14:00", "DS120"),
        ("thursday", "12:00", "14:00", "MS110"),
    ),
    ("B", "A"): (
        ("sunday", "08:00", "10:00", "MS120"),
        ("sunday", "10:00", "12:00", "DS120"),
        ("monday", "08:00", "10:00", "DS120"),
        ("tuesday", "08:00", "10:00", "MS140"),
        ("tuesday", "10:00", "12:00", "MS110"),
        ("wednesday", "08:00", "10:00", "DS110"),
        ("thursday", "08:00", "10:00", "MS130"),
        ("thursday", "10:00", "12:00", "DS110"),
    ),
    ("B", "B"): (
        ("sunday", "08:00", "10:00", "MS110"),
        ("sunday", "10:00", "12:00", "MS140"),
        ("monday", "08:00", "10:00", "DS110"),
        ("tuesday", "08:00", "10:00", "MS130"),
        ("tuesday", "10:00", "12:00", "DS120"),
        ("wednesday", "08:00", "10:00", "DS120"),
        ("thursday", "08:00", "10:00", "DS110"),
        ("thursday", "10:00", "12:00", "MS120"),
    ),
    ("B", "C"): (
        ("sunday", "08:00", "10:00", "DS120"),
        ("sunday", "10:00", "12:00", "DS110"),
        ("monday", "08:00", "10:00", "MS110"),
        ("tuesday", "08:00", "10:00", "DS110"),
        ("tuesday", "10:00", "12:00", "MS130"),
        ("wednesday", "08:00", "10:00", "MS120"),
        ("thursday", "08:00", "10:00", "MS140"),
        ("thursday", "10:00", "12:00", "DS120"),
    ),
    ("B", "D"): (
        ("sunday", "08:00", "10:00", "DS110"),
        ("sunday", "10:00", "12:00", "MS130"),
        ("monday", "08:00", "10:00", "MS120"),
        ("tuesday", "08:00", "10:00", "DS120"),
        ("tuesday", "10:00", "12:00", "DS110"),
        ("wednesday", "08:00", "10:00", "MS140"),
        ("thursday", "08:00", "10:00", "DS120"),
        ("thursday", "10:00", "12:00", "MS110"),
    ),
}

PRACTICAL_SESSIONS: tuple[PracticalSession, ...] = tuple(
    PracticalSession(theory, practical, day, start, end, _SUBJECT_BY_CODE[code])
    for (theory, practical), cells in _PRACTICAL.items()
    for day, start, end, code in cells
)

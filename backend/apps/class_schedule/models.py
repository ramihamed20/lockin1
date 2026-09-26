from django.conf import settings
from django.db import models
from django.db.models import Q

from .schedule_data import PRACTICAL_GROUPS, SUBJECTS, THEORY_GROUPS
from .schedule_data_year1 import PRACTICAL_GROUPS as YEAR_1_PRACTICAL_GROUPS

THEORY_GROUP_CHOICES: list[tuple[str, str]] = [(group, group) for group in THEORY_GROUPS]
PRACTICAL_GROUP_CHOICES: list[tuple[str, str]] = [(group, group) for group in PRACTICAL_GROUPS]
YEAR_1_PRACTICAL_GROUP_CHOICES: list[tuple[str, str]] = [
    (group, group) for group in YEAR_1_PRACTICAL_GROUPS
]
SUBJECT_CHOICES = [(subject, subject) for subject in SUBJECTS]


class MyGroupPreference(models.Model):
    """A student's "My Group" choice. No row means the student has not set it up yet.

    ``academic_year`` records which year's timetable the choice belongs to, so a
    choice made in one year is never resolved against another year's sessions.
    In Year 1 ``default_practical_group`` is simply the practical group (A-D,
    inside the theory group) and there are no per-subject overrides.
    """

    class AcademicYear(models.TextChoices):
        YEAR_1 = "year-1", "Year 1"
        YEAR_2 = "year-2", "Year 2"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="my_group_preference",
    )
    academic_year = models.CharField(
        max_length=8, choices=AcademicYear.choices, default=AcademicYear.YEAR_2
    )
    theory_group = models.CharField(max_length=1, choices=THEORY_GROUP_CHOICES)
    default_practical_group = models.CharField(
        max_length=2, choices=PRACTICAL_GROUP_CHOICES + YEAR_1_PRACTICAL_GROUP_CHOICES
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(theory_group__in=THEORY_GROUPS),
                name="my_group_theory_group_valid",
            ),
            models.CheckConstraint(
                condition=Q(academic_year="year-2", default_practical_group__in=PRACTICAL_GROUPS)
                | Q(academic_year="year-1", default_practical_group__in=YEAR_1_PRACTICAL_GROUPS),
                name="my_group_practical_matches_year",
            ),
        ]

    def __str__(self) -> str:
        groups = f"{self.theory_group}/{self.default_practical_group}"
        return f"{self.user_id}:{self.academic_year}:{groups}"


class MyGroupPracticalOverride(models.Model):
    """One practical subject taken from a schedule set and group other than the default."""

    preference = models.ForeignKey(
        MyGroupPreference,
        on_delete=models.CASCADE,
        related_name="practical_overrides",
    )
    subject = models.CharField(max_length=40, choices=SUBJECT_CHOICES)
    schedule_set = models.CharField(max_length=1, choices=THEORY_GROUP_CHOICES)
    practical_group = models.CharField(max_length=2, choices=PRACTICAL_GROUP_CHOICES)

    class Meta:
        ordering = ("subject",)
        constraints = [
            models.UniqueConstraint(
                fields=("preference", "subject"),
                name="my_group_override_one_per_subject",
            ),
            models.CheckConstraint(
                condition=Q(subject__in=SUBJECTS),
                name="my_group_override_subject_valid",
            ),
            models.CheckConstraint(
                condition=Q(schedule_set__in=THEORY_GROUPS),
                name="my_group_override_set_valid",
            ),
            models.CheckConstraint(
                condition=Q(practical_group__in=PRACTICAL_GROUPS),
                name="my_group_override_group_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.preference_id}:{self.subject}={self.schedule_set}/{self.practical_group}"

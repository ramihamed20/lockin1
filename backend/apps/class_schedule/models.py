from django.conf import settings
from django.db import models
from django.db.models import Q

from .schedule_data import PRACTICAL_GROUPS, SUBJECTS, THEORY_GROUPS

THEORY_GROUP_CHOICES = [(group, group) for group in THEORY_GROUPS]
PRACTICAL_GROUP_CHOICES = [(group, group) for group in PRACTICAL_GROUPS]
SUBJECT_CHOICES = [(subject, subject) for subject in SUBJECTS]


class MyGroupPreference(models.Model):
    """A student's "My Group" choice. No row means the student has not set it up yet."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="my_group_preference",
    )
    theory_group = models.CharField(max_length=1, choices=THEORY_GROUP_CHOICES)
    default_practical_group = models.CharField(max_length=2, choices=PRACTICAL_GROUP_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(theory_group__in=THEORY_GROUPS),
                name="my_group_theory_group_valid",
            ),
            models.CheckConstraint(
                condition=Q(default_practical_group__in=PRACTICAL_GROUPS),
                name="my_group_default_practical_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.theory_group}/{self.default_practical_group}"


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

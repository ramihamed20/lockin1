import pytest
from django.contrib.auth.models import Group
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.roles import Role
from apps.accounts.tests.helpers import create_user
from apps.progress.models import LessonProgress

from ..cohort_transition import change_student_cohort
from ..models import AcademicProgram, StudentCohort
from .helpers import create_admin, published_path

pytestmark = pytest.mark.django_db


def cohorts() -> tuple[StudentCohort, StudentCohort, object]:
    admin = create_admin(email="cohort-transition-admin@example.com")
    root, _, lesson = published_path(admin=admin)
    program = AcademicProgram.objects.create(
        code="transition-program", name_en="Transition", name_ar="Transition"
    )
    old = StudentCohort.objects.create(program=program, code="old", name_en="Old", name_ar="Old")
    new = StudentCohort.objects.create(program=program, code="new", name_en="New", name_ar="New")
    old.content_nodes.add(root)
    return old, new, lesson


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_student_path_change_preserves_prior_path_study_state() -> None:
    old, new, lesson = cohorts()
    student = create_user(email="cohort-change@example.com", cohort=old)
    student.avatar_default = student.AvatarDefault.FEMALE_CALICO
    student.mascot_preference = student.MascotPreference.BLACK
    student.theme_preference = student.ThemePreference.SUNSET
    student.save()
    LessonProgress.objects.create(user=student, lesson=lesson, completed_at=timezone.now())

    client = APIClient()
    client.force_authenticate(student)
    response = client.patch(
        "/api/v1/account/profile",
        {"cohort_id": str(new.id), "confirm_cohort_change": True},
        format="json",
    )

    assert response.status_code == 200
    student.refresh_from_db()
    assert student.cohort_id == new.id
    assert LessonProgress.objects.filter(user=student, lesson=lesson).exists()
    assert student.email == "cohort-change@example.com"
    assert student.avatar_default == student.AvatarDefault.FEMALE_CALICO
    assert student.mascot_preference == student.MascotPreference.BLACK
    assert student.theme_preference == student.ThemePreference.SUNSET


def test_founder_context_change_never_mutates_or_clears_their_account() -> None:
    old, new, lesson = cohorts()
    founder = create_user(email="founder-context@example.com", cohort=old)
    Group.objects.get(name=Role.ADMINISTRATOR.value).user_set.add(founder)
    LessonProgress.objects.create(user=founder, lesson=lesson, completed_at=timezone.now())
    identity = (founder.email, founder.full_name, founder.avatar_default, founder.cohort_id)

    assert change_student_cohort(user=founder, cohort=new) is False
    founder.refresh_from_db()
    assert (founder.email, founder.full_name, founder.avatar_default, founder.cohort_id) == identity
    assert LessonProgress.objects.filter(user=founder, lesson=lesson).exists()

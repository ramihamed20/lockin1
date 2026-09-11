"""One ACTIVE run per user, sheet and difficulty -- decided by the database.

``start`` reads with ``select_for_update()`` and creates when it finds nothing.
That read cannot lock a row that does not exist, so two concurrent starts -- a
double tap, or a client retrying after a timeout -- both found nothing and both
inserted. Progress then split across two runs and appeared to move backwards,
because ``availability`` reports the most recently updated run while the client
holds the other.

The partial unique index is what actually decides the race now; the code's job is
to lose it gracefully and resume the run that won.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
from django.db import IntegrityError, transaction

from apps.focus.managed_active_study import start

from ..models import ActiveStudyRun
from .test_managed_active_study import _setup

pytestmark = pytest.mark.django_db


def test_a_second_active_run_cannot_be_inserted_for_the_same_sheet_and_difficulty() -> None:
    user, sheet, _ = _setup()
    run, created = start(user=user, sheet_id=sheet.id, difficulty="medium")
    assert created is True

    with pytest.raises(IntegrityError), transaction.atomic():
        ActiveStudyRun.objects.create(
            user=user,
            sheet=sheet,
            material_slug="managed-sheet",
            sheet_slug=str(sheet.id),
            difficulty="medium",
            page_count=run.page_count,
            unlocked_pages=run.unlocked_pages,
            plan_signature=run.plan_signature,
        )

    assert ActiveStudyRun.objects.filter(status=ActiveStudyRun.Status.ACTIVE).count() == 1


def test_losing_the_insert_race_resumes_the_run_that_won() -> None:
    """The caller that loses must resume, not fail.

    ``_active_run`` is forced to report nothing on the first look, which is
    exactly what the losing request saw before the winner committed. The insert
    then violates the constraint, and the recovery path has to find the winner.
    """

    user, sheet, _ = _setup()
    winner, created = start(user=user, sheet_id=sheet.id, difficulty="medium")
    assert created is True

    real_active_run = ActiveStudyRun.objects.filter
    looks: list[int] = []

    def blind_first_look(**kwargs: Any) -> Any:
        looks.append(1)
        if len(looks) == 1:
            return None
        return (
            real_active_run(
                user=kwargs["user"],
                sheet=kwargs["sheet"],
                difficulty=kwargs["difficulty"],
                status=ActiveStudyRun.Status.ACTIVE,
            )
            .order_by("-updated_at")
            .first()
        )

    with patch("apps.focus.managed_active_study._active_run", side_effect=blind_first_look):
        resumed, created_again = start(user=user, sheet_id=sheet.id, difficulty="medium")

    assert created_again is False
    assert resumed.id == winner.id
    assert ActiveStudyRun.objects.filter(status=ActiveStudyRun.Status.ACTIVE).count() == 1


def test_a_different_difficulty_is_still_its_own_run() -> None:
    """The constraint is per difficulty, so it must not block a second one."""

    user, sheet, _ = _setup()
    medium, created = start(user=user, sheet_id=sheet.id, difficulty="medium")
    assert created is True

    # "easy" has no configured question content in this fixture, so reaching the
    # constraint at all is what matters: the insert must not be refused for
    # sharing a sheet with the medium run.
    ActiveStudyRun.objects.create(
        user=user,
        sheet=sheet,
        material_slug="managed-sheet",
        sheet_slug=str(sheet.id),
        difficulty="easy",
        page_count=medium.page_count,
        unlocked_pages=medium.unlocked_pages,
        plan_signature=medium.plan_signature,
    )

    assert ActiveStudyRun.objects.filter(status=ActiveStudyRun.Status.ACTIVE).count() == 2


def test_a_completed_run_leaves_room_for_a_new_one() -> None:
    """The index covers ACTIVE rows only, so history never blocks a fresh start."""

    user, sheet, _ = _setup()
    first, _ = start(user=user, sheet_id=sheet.id, difficulty="medium")
    ActiveStudyRun.objects.filter(id=first.id).update(status=ActiveStudyRun.Status.COMPLETED)

    second, created = start(user=user, sheet_id=sheet.id, difficulty="medium")

    assert created is True
    assert second.id != first.id
    assert ActiveStudyRun.objects.filter(sheet=sheet, user=user).count() == 2


def test_legacy_catalogue_runs_without_a_sheet_are_not_covered() -> None:
    """NULL sheet ids stay distinct, so legacy rows cannot block the migration."""

    user, _, _ = _setup()
    for _ in range(2):
        ActiveStudyRun.objects.create(
            user=user,
            sheet=None,
            material_slug="oral-histology",
            sheet_slug="sheet-4",
            difficulty="medium",
            page_count=16,
            unlocked_pages=3,
        )

    assert ActiveStudyRun.objects.filter(sheet__isnull=True).count() == 2

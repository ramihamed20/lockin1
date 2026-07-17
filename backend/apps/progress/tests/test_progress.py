from typing import Any

import pytest
from django.db import IntegrityError

from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, published_path

from ..events import LessonCompleted
from ..models import Bookmark, LearningProgress
from ..selectors import learning_dashboard
from ..services import (
    ProgressConflictError,
    complete_lesson,
    set_bookmark,
    update_learning_progress,
)

pytestmark = pytest.mark.django_db


def test_bookmark_is_idempotent_and_uniquely_constrained() -> None:
    from apps.accounts.tests.helpers import create_user

    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    content = published_pdf(actor=admin, node=lesson)

    first, created = set_bookmark(user=student, learning_object_id=content.id)
    second, repeated = set_bookmark(user=student, learning_object_id=content.id)

    assert created is True
    assert repeated is False
    assert first.id == second.id
    with pytest.raises(IntegrityError):
        Bookmark.objects.create(user=student, learning_object=content)


def test_progress_updates_are_revision_aware_and_version_bound() -> None:
    from apps.accounts.tests.helpers import create_user

    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    content = published_pdf(actor=admin, node=lesson)

    progress = update_learning_progress(
        user=student,
        learning_object_id=content.id,
        expected_revision=0,
        status=LearningProgress.Status.IN_PROGRESS,
        completion_percent=35,
        position={"page": 8, "zoom": 1.25},
    )

    assert progress.version_id == content.published_version_id
    assert progress.revision == 1
    with pytest.raises(ProgressConflictError):
        update_learning_progress(
            user=student,
            learning_object_id=content.id,
            expected_revision=0,
            status=LearningProgress.Status.COMPLETED,
            completion_percent=100,
            position={"page": 9},
        )


def test_lesson_completion_is_idempotent_and_emits_once(
    django_capture_on_commit_callbacks: Any,
) -> None:
    from apps.accounts.tests.helpers import create_user
    from platform_core.events import DomainEvent, domain_events

    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    received: list[DomainEvent] = []
    unsubscribe = domain_events.subscribe(LessonCompleted, received.append)
    try:
        with django_capture_on_commit_callbacks(execute=True):
            first = complete_lesson(user=student, lesson_id=lesson.id, expected_revision=0)
        second = complete_lesson(
            user=student,
            lesson_id=lesson.id,
            expected_revision=first.revision,
        )
    finally:
        unsubscribe()

    assert first.id == second.id
    assert len(received) == 1
    assert isinstance(received[0], LessonCompleted)
    assert received[0].lesson_id == lesson.id


def test_dashboard_prefers_resume_over_bookmark() -> None:
    from apps.accounts.tests.helpers import create_user

    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    content = published_pdf(actor=admin, node=lesson)
    set_bookmark(user=student, learning_object_id=content.id)
    update_learning_progress(
        user=student,
        learning_object_id=content.id,
        expected_revision=0,
        status=LearningProgress.Status.IN_PROGRESS,
        completion_percent=42,
        position={"page": 4},
    )

    dashboard = learning_dashboard(user=student)

    assert dashboard["next_item"] == {
        "learning_object_id": content.id,
        "title": "Cranial nerves guide",
        "content_type": "pdf",
        "reason": "resume",
        "completion_percent": 42,
    }
    assert dashboard["bookmark_count"] == 1

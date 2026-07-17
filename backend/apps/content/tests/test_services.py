from typing import Any

import pytest

from apps.discovery.models import SearchEntry
from apps.education.services import ScopeCapabilities, grant_creator_scope
from apps.education.tests.helpers import create_admin, create_creator, pdf_upload, published_path
from apps.files.services import create_managed_file

from ..events import ContentPublished
from ..models import LearningObject, LearningObjectVersion
from ..selectors import published_learning_object
from ..services import (
    ContentConflictError,
    ContentRuleError,
    LearningObjectInput,
    archive_learning_object,
    create_learning_object,
    publish_learning_object,
    revise_learning_object,
    submit_for_review,
)

pytestmark = pytest.mark.django_db


def test_publish_creates_search_projection_event_and_immutable_version(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")
    data = LearningObjectInput(
        academic_node=lesson,
        content_type=LearningObjectVersion.ContentType.PDF,
        title="Cranial nerves guide",
        summary="Read before practice.",
        primary_file=managed_file,
    )
    learning_object = create_learning_object(actor=admin, data=data)
    learning_object = submit_for_review(
        actor=admin,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
    )

    from platform_core.events import DomainEvent, domain_events

    received: list[DomainEvent] = []
    unsubscribe = domain_events.subscribe(ContentPublished, received.append)
    try:
        with django_capture_on_commit_callbacks(execute=True):
            learning_object = publish_learning_object(
                actor=admin,
                learning_object_id=learning_object.id,
                expected_revision=learning_object.revision,
            )
    finally:
        unsubscribe()

    assert learning_object.published_version_id == learning_object.current_version_id
    assert SearchEntry.objects.get(resource_id=learning_object.id).title == data.title
    assert len(received) == 1
    assert isinstance(received[0], ContentPublished)
    assert received[0].learning_object_id == learning_object.id


def test_revising_published_content_keeps_student_release_until_republished() -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    managed_file = create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf")
    first = LearningObjectInput(
        academic_node=lesson,
        content_type="pdf",
        title="Version one",
        primary_file=managed_file,
    )
    learning_object = create_learning_object(actor=admin, data=first)
    learning_object = submit_for_review(
        actor=admin,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
    )
    learning_object = publish_learning_object(
        actor=admin,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
    )
    first_published_id = learning_object.published_version_id

    learning_object = revise_learning_object(
        actor=admin,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
        data=LearningObjectInput(
            academic_node=lesson,
            content_type="pdf",
            title="Version two draft",
            primary_file=managed_file,
        ),
    )

    public = published_learning_object(learning_object_id=learning_object.id)
    assert learning_object.workflow_status == LearningObject.WorkflowStatus.DRAFT
    assert learning_object.current_version_id != first_published_id
    assert public.published_version_id == first_published_id
    assert public.published_version is not None
    assert public.published_version.title == "Version one"
    with pytest.raises(ContentConflictError):
        revise_learning_object(
            actor=admin,
            learning_object_id=learning_object.id,
            expected_revision=learning_object.revision - 1,
            data=first,
        )


def test_creator_scope_separates_create_from_publish() -> None:
    admin = create_admin()
    creator = create_creator()
    _, subject, lesson = published_path(admin=admin)
    grant_creator_scope(
        actor=admin,
        user=creator,
        node=subject,
        capabilities=ScopeCapabilities(can_create_content=True),
    )
    managed_file = create_managed_file(owner=creator, upload=pdf_upload(), kind="pdf")
    learning_object = create_learning_object(
        actor=creator,
        data=LearningObjectInput(
            academic_node=lesson,
            content_type="pdf",
            title="Creator draft",
            primary_file=managed_file,
        ),
    )
    learning_object = submit_for_review(
        actor=creator,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
    )

    with pytest.raises(ContentRuleError):
        publish_learning_object(
            actor=creator,
            learning_object_id=learning_object.id,
            expected_revision=learning_object.revision,
        )


def test_video_metadata_can_reach_review_but_cannot_be_published() -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    learning_object = create_learning_object(
        actor=admin,
        data=LearningObjectInput(
            academic_node=lesson,
            content_type="video",
            title="Future lecture",
            metadata={"duration_seconds": 900},
        ),
    )
    learning_object = submit_for_review(
        actor=admin,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
    )

    assert learning_object.workflow_status == LearningObject.WorkflowStatus.IN_REVIEW
    with pytest.raises(ContentRuleError, match="not implemented"):
        publish_learning_object(
            actor=admin,
            learning_object_id=learning_object.id,
            expected_revision=learning_object.revision,
        )


def test_archive_removes_content_from_search() -> None:
    from .helpers import published_pdf

    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    learning_object = published_pdf(actor=admin, node=lesson)

    archive_learning_object(
        actor=admin,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
    )

    assert not SearchEntry.objects.filter(resource_id=learning_object.id).exists()

from typing import Any
from uuid import uuid4

import pytest
from django.test import override_settings

from apps.accounts.tests.helpers import create_user
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, published_path
from platform_core.events import DomainEvent, domain_events

from ..events import DiscussionCreated, DiscussionReplyCreated
from ..models import (
    Comment,
    CommentRevision,
    CommunitySpace,
    Discussion,
    DiscussionRevision,
    SpaceMembership,
    SpaceMembershipHistory,
)
from ..services import (
    CommunityConflictError,
    CommunityRateLimitError,
    CommunityRuleError,
    create_comment,
    create_discussion,
    create_space,
    delete_own_comment,
    delete_own_discussion,
    edit_comment,
    edit_discussion,
    revoke_space_member,
    set_space_member,
)
from .helpers import scoped_creator

pytestmark = pytest.mark.django_db


def test_contextual_discussion_lifecycle_is_idempotent_versioned_and_evented(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    request_id = uuid4()
    received: list[DomainEvent] = []
    unsubscribe = domain_events.subscribe(DiscussionCreated, received.append)
    try:
        with django_capture_on_commit_callbacks(execute=True):
            discussion = create_discussion(
                actor=student,
                context_type="lesson",
                context_id=lesson.id,
                title="How does this pathway connect clinically?",
                body="I understand the anatomy, but I need help connecting each step to the case.",
                client_request_id=request_id,
            )
    finally:
        unsubscribe()
    assert discussion.context_title == lesson.title
    assert discussion.context_route.endswith(str(lesson.id))
    assert DiscussionRevision.objects.get(discussion=discussion).reason == "created"
    created_events = [event for event in received if isinstance(event, DiscussionCreated)]
    assert [event.discussion_id for event in created_events] == [discussion.id]

    retried = create_discussion(
        actor=student,
        context_type="lesson",
        context_id=lesson.id,
        title=discussion.title,
        body=discussion.body,
        client_request_id=request_id,
    )
    assert retried.id == discussion.id
    with pytest.raises(CommunityConflictError):
        create_discussion(
            actor=student,
            context_type="lesson",
            context_id=lesson.id,
            title="A different request using the same identifier",
            body="This payload is intentionally different and must not overwrite the first one.",
            client_request_id=request_id,
        )

    edited = edit_discussion(
        actor=student,
        discussion_id=discussion.id,
        expected_revision=1,
        title="How does this pathway connect to the case?",
        body="I reviewed the anatomy and now need help applying each step to the clinical case.",
    )
    assert edited.revision == 2
    with pytest.raises(CommunityConflictError):
        edit_discussion(
            actor=student,
            discussion_id=discussion.id,
            expected_revision=1,
            title=edited.title,
            body=edited.body,
        )
    deleted = delete_own_discussion(
        actor=student,
        discussion_id=discussion.id,
        expected_revision=2,
    )
    assert deleted.status == Discussion.Status.AUTHOR_DELETED
    assert deleted.deleted_at is not None
    assert list(deleted.revisions.values_list("reason", flat=True)) == [
        "created",
        "edited",
        "author_deleted",
    ]


def test_comments_support_one_reply_level_revisions_and_tombstones(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin = create_admin()
    author = create_user()
    helper = create_user(email="helper@example.com", full_name="Helpful Student")
    _, _, lesson = published_path(admin=admin)
    discussion = create_discussion(
        actor=author,
        context_type="lesson",
        context_id=lesson.id,
        title="Which landmark makes this easier to identify?",
        body=(
            "I can identify the structure in isolation, but the nearby landmark still confuses me."
        ),
        client_request_id=uuid4(),
    )
    received: list[DomainEvent] = []
    unsubscribe = domain_events.subscribe(DiscussionReplyCreated, received.append)
    try:
        with django_capture_on_commit_callbacks(execute=True):
            comment = create_comment(
                actor=helper,
                discussion_id=discussion.id,
                body=(
                    "Start from the larger landmark and trace the border "
                    "before naming the structure."
                ),
                client_request_id=uuid4(),
            )
            reply = create_comment(
                actor=author,
                discussion_id=discussion.id,
                parent_id=comment.id,
                body="That sequence makes the relationship much clearer. Thank you.",
                client_request_id=uuid4(),
            )
    finally:
        unsubscribe()
    discussion.refresh_from_db()
    assert discussion.comment_count == 2
    reply_events = [event for event in received if isinstance(event, DiscussionReplyCreated)]
    assert [event.parent_comment_id for event in reply_events] == [None, comment.id]
    with pytest.raises(CommunityRuleError, match="one level"):
        create_comment(
            actor=helper,
            discussion_id=discussion.id,
            parent_id=reply.id,
            body="This third level must be rejected.",
            client_request_id=uuid4(),
        )

    edited = edit_comment(
        actor=helper,
        comment_id=comment.id,
        expected_revision=1,
        body="Start from the larger landmark, then trace its border before naming the structure.",
    )
    assert edited.revision == 2
    deleted = delete_own_comment(actor=helper, comment_id=comment.id, expected_revision=2)
    assert deleted.status == Comment.Status.AUTHOR_DELETED
    assert CommentRevision.objects.filter(comment=comment).count() == 3


def test_private_creator_space_membership_is_explicit_and_revocation_is_immediate() -> None:
    admin = create_admin()
    student = create_user()
    outsider = create_user(email="outsider@example.com", full_name="Outside Student")
    _, _, lesson = published_path(admin=admin)
    creator = scoped_creator(admin=admin, node=lesson)
    space = create_space(
        actor=creator,
        context_type="lesson",
        context_id=lesson.id,
        title="Cranial nerves study room",
        description="A private asynchronous room for this lesson.",
    )
    membership = set_space_member(
        actor=creator,
        space_id=space.id,
        user=student,
        role=SpaceMembership.Role.MEMBER,
    )
    assert membership.status == SpaceMembership.Status.ACTIVE
    assert SpaceMembershipHistory.objects.get(membership=membership).action == "invited"
    private_discussion = create_discussion(
        actor=student,
        context_type="lesson",
        context_id=lesson.id,
        space_id=space.id,
        title="Can we compare the two branches here?",
        body="I would like to compare the two branches using the lesson diagram and our notes.",
        client_request_id=uuid4(),
    )
    assert private_discussion.space_id == space.id
    with pytest.raises(CommunityRuleError, match="cannot post"):
        create_discussion(
            actor=outsider,
            context_type="lesson",
            context_id=lesson.id,
            space_id=space.id,
            title="I should not be able to post here",
            body="This user has no explicit membership and private data must stay inaccessible.",
            client_request_id=uuid4(),
        )
    revoke_space_member(actor=creator, space_id=space.id, user_id=student.id)
    membership.refresh_from_db()
    assert membership.status == SpaceMembership.Status.REVOKED
    assert membership.revoked_at is not None
    with pytest.raises(CommunityRuleError, match="cannot post"):
        create_discussion(
            actor=student,
            context_type="lesson",
            context_id=lesson.id,
            space_id=space.id,
            title="Revoked membership cannot be cached",
            body="The previous membership must not continue granting access after it is revoked.",
            client_request_id=uuid4(),
        )


@override_settings(COMMUNITY_DISCUSSION_RATE_LIMIT=1)
def test_duplicate_and_rate_controls_fail_closed() -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    body = "This explanation is repeated to verify the duplicate spam protection works correctly."
    create_discussion(
        actor=student,
        context_type="lesson",
        context_id=lesson.id,
        title="First contextual discussion for this test",
        body=body,
        client_request_id=uuid4(),
    )
    with pytest.raises(CommunityRuleError, match="already posted"):
        create_discussion(
            actor=student,
            context_type="lesson",
            context_id=lesson.id,
            title="Same content should not be posted twice",
            body=body,
            client_request_id=uuid4(),
        )
    with pytest.raises(CommunityRateLimitError):
        create_discussion(
            actor=student,
            context_type="lesson",
            context_id=lesson.id,
            title="Second different discussion still exceeds the bucket",
            body="This is a different body, so the atomic rate bucket should reject it instead.",
            client_request_id=uuid4(),
        )


def test_context_rejects_non_lesson_nodes_and_space_context_mismatch() -> None:
    admin = create_admin()
    student = create_user()
    _, subject, lesson = published_path(admin=admin)
    with pytest.raises(CommunityRuleError, match="not found"):
        create_discussion(
            actor=student,
            context_type="lesson",
            context_id=subject.id,
            title="Subjects are not lesson discussions",
            body="The system should not silently treat a subject as a lesson discussion context.",
            client_request_id=uuid4(),
        )
    creator = scoped_creator(admin=admin, node=lesson)
    space = create_space(
        actor=creator,
        context_type="lesson",
        context_id=lesson.id,
        title="Lesson-specific creator room",
        description="This space is intentionally tied to one lesson.",
    )
    with pytest.raises(CommunityRuleError, match="must match"):
        learning_object = published_pdf(actor=admin, node=lesson)
        create_discussion(
            actor=creator,
            context_type="learning_object",
            context_id=learning_object.id,
            space_id=space.id,
            title="A mismatched context must not enter this space",
            body="This discussion should be rejected before any private-space data is written.",
            client_request_id=uuid4(),
        )
    assert CommunitySpace.objects.count() == 1

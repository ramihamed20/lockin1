from uuid import uuid4

import pytest

from apps.accounts.tests.helpers import create_user
from apps.assessments.tests.helpers import published_quiz
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, published_path
from apps.questions.tests.helpers import published_question

from ..context import CommunityContextError, resolve_context
from ..models import Comment, CommunitySpace, Discussion, SpaceMembership, SpaceMembershipHistory
from ..services import (
    CommunityRuleError,
    create_comment,
    create_space,
    moderate_content,
    revoke_space_member,
    set_space_member,
)
from .helpers import create_moderator, lesson_discussion

pytestmark = pytest.mark.django_db


def test_every_supported_learning_context_resolves_to_a_stable_snapshot() -> None:
    admin = create_admin()
    student = create_user()
    _, _, lesson = published_path(admin=admin)
    learning_object = published_pdf(actor=admin, node=lesson)
    question = published_question(actor=admin, node=lesson)
    quiz = published_quiz(actor=admin, node=lesson, questions=(question,))
    learning_object_version = learning_object.published_version
    question_version = question.published_version
    quiz_version = quiz.published_version
    assert learning_object_version is not None
    assert question_version is not None
    assert quiz_version is not None

    expected = {
        "lesson": (lesson.id, lesson.title, f"/learn/nodes/{lesson.id}"),
        "learning_object": (
            learning_object.id,
            learning_object_version.title,
            f"/learn/content/{learning_object.id}",
        ),
        "question": (question.id, question_version.prompt, "/assessments"),
        "quiz": (quiz.id, quiz_version.title, f"/assessments/quizzes/{quiz.id}"),
    }

    for context_type, (context_id, title, route) in expected.items():
        snapshot = resolve_context(
            user=student,
            context_type=context_type,
            context_id=context_id,
        )
        assert (snapshot.context_id, snapshot.title, snapshot.route) == (context_id, title, route)
        assert snapshot.academic_node.id == lesson.id

    for context_type in ("learning_object", "question", "quiz", "unsupported"):
        with pytest.raises(CommunityContextError):
            resolve_context(user=student, context_type=context_type, context_id=uuid4())


def test_creator_space_membership_history_is_complete_and_server_authoritative() -> None:
    admin = create_admin()
    student = create_user()
    outsider = create_user(email="outsider@example.com")
    _, _, lesson = published_path(admin=admin)
    space = create_space(
        actor=admin,
        context_type="lesson",
        context_id=lesson.id,
        title="Cranial nerves study room",
        description="A contextual room for this lesson only.",
    )
    assert (
        create_space(
            actor=admin,
            context_type="lesson",
            context_id=lesson.id,
            title="A retry does not create another room",
            description="Idempotent per owner and learning context.",
        ).id
        == space.id
    )

    membership = set_space_member(
        actor=admin,
        space_id=space.id,
        user=student,
        role=SpaceMembership.Role.MEMBER,
    )
    assert membership.status == SpaceMembership.Status.ACTIVE
    changed = set_space_member(
        actor=admin,
        space_id=space.id,
        user=student,
        role=SpaceMembership.Role.MODERATOR,
    )
    assert changed.role == SpaceMembership.Role.MODERATOR
    revoked = revoke_space_member(actor=admin, space_id=space.id, user_id=student.id)
    assert revoked.status == SpaceMembership.Status.REVOKED
    assert revoke_space_member(actor=admin, space_id=space.id, user_id=student.id).id == revoked.id
    restored = set_space_member(
        actor=admin,
        space_id=space.id,
        user=student,
        role=SpaceMembership.Role.MEMBER,
    )
    assert restored.status == SpaceMembership.Status.ACTIVE
    assert list(
        SpaceMembershipHistory.objects.filter(membership=membership).values_list(
            "action", flat=True
        )
    ) == ["invited", "role_changed", "revoked", "restored"]

    with pytest.raises(CommunityRuleError, match="Unsupported"):
        set_space_member(actor=admin, space_id=space.id, user=outsider, role="owner")
    with pytest.raises(CommunityRuleError, match="owner"):
        set_space_member(
            actor=admin,
            space_id=space.id,
            user=admin,
            role=SpaceMembership.Role.MEMBER,
        )
    with pytest.raises(CommunityRuleError, match="cannot manage"):
        set_space_member(
            actor=outsider,
            space_id=space.id,
            user=student,
            role=SpaceMembership.Role.MEMBER,
        )
    with pytest.raises(CommunityRuleError, match="cannot manage"):
        revoke_space_member(actor=outsider, space_id=space.id, user_id=student.id)


def test_moderation_supports_reversible_discussion_and_comment_actions() -> None:
    admin = create_admin()
    author = create_user()
    helper = create_user(email="helper@example.com")
    moderator = create_moderator()
    outsider = create_user(email="outsider@example.com")
    _, _, lesson = published_path(admin=admin)
    discussion = lesson_discussion(author=author, lesson=lesson)
    comment = create_comment(
        actor=helper,
        discussion_id=discussion.id,
        body="This reply is long enough to be moderated and restored safely.",
        client_request_id=uuid4(),
    )
    reason = "Confirmed by an independent moderator after reviewing the evidence."

    with pytest.raises(CommunityRuleError, match="between 10"):
        moderate_content(
            actor=moderator,
            target_type="discussion",
            target_id=discussion.id,
            action="remove",
            reason="short",
        )
    with pytest.raises(CommunityRuleError, match="cannot moderate"):
        moderate_content(
            actor=outsider,
            target_type="discussion",
            target_id=discussion.id,
            action="remove",
            reason=reason,
        )
    with pytest.raises(CommunityRuleError, match="Only moderator-removed"):
        moderate_content(
            actor=moderator,
            target_type="discussion",
            target_id=discussion.id,
            action="restore",
            reason=reason,
        )

    for action, expected_status in (
        ("lock", Discussion.Status.LOCKED),
        ("unlock", Discussion.Status.ACTIVE),
        ("remove", Discussion.Status.MODERATOR_REMOVED),
        ("restore", Discussion.Status.ACTIVE),
    ):
        result = moderate_content(
            actor=moderator,
            target_type="discussion",
            target_id=discussion.id,
            action=action,
            reason=reason,
        )
        assert result.status == expected_status

    with pytest.raises(CommunityRuleError, match="Unsupported moderation"):
        moderate_content(
            actor=moderator,
            target_type="discussion",
            target_id=discussion.id,
            action="hide",
            reason=reason,
        )
    with pytest.raises(CommunityRuleError, match="cannot moderate"):
        moderate_content(
            actor=outsider,
            target_type="comment",
            target_id=comment.id,
            action="remove",
            reason=reason,
        )
    with pytest.raises(CommunityRuleError, match="Only moderator-removed"):
        moderate_content(
            actor=moderator,
            target_type="comment",
            target_id=comment.id,
            action="restore",
            reason=reason,
        )
    removed = moderate_content(
        actor=moderator,
        target_type="comment",
        target_id=comment.id,
        action="remove",
        reason=reason,
    )
    assert removed.status == Comment.Status.MODERATOR_REMOVED
    restored = moderate_content(
        actor=moderator,
        target_type="comment",
        target_id=comment.id,
        action="restore",
        reason=reason,
    )
    assert restored.status == Comment.Status.ACTIVE
    with pytest.raises(CommunityRuleError, match="Unsupported moderation"):
        moderate_content(
            actor=moderator,
            target_type="comment",
            target_id=comment.id,
            action="lock",
            reason=reason,
        )
    with pytest.raises(CommunityRuleError, match="Unsupported community target"):
        moderate_content(
            actor=moderator,
            target_type="lesson",
            target_id=lesson.id,
            action="remove",
            reason=reason,
        )

    discussion.refresh_from_db()
    comment.refresh_from_db()
    assert discussion.revision == 5
    assert comment.revision == 3
    assert CommunitySpace.objects.count() == 0

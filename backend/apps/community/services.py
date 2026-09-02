import hashlib
import re
from datetime import datetime, timedelta
from uuid import UUID

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.accounts.models import User
from platform_core.events import publish_after_commit

from .context import CommunityContextError, can_create_space_for_context, resolve_context
from .events import (
    CommunityContentChanged,
    CreatorSpaceMembershipChanged,
    DiscussionCreated,
    DiscussionReplyCreated,
)
from .models import (
    Comment,
    CommentRevision,
    CommunityRateBucket,
    CommunitySpace,
    Discussion,
    DiscussionRevision,
    SpaceMembership,
    SpaceMembershipHistory,
)
from .policies import (
    can_create_in_space,
    can_edit_discussion,
    can_manage_space,
    can_moderate_space,
    can_remove_discussion,
    can_view_discussion,
)


class CommunityRuleError(ValueError):
    pass


class CommunityConflictError(ValueError):
    pass


class CommunityRateLimitError(ValueError):
    pass


_URL_PATTERN = re.compile(r"https?://", re.IGNORECASE)


def _clean_text(value: str, *, label: str, minimum: int, maximum: int) -> str:
    cleaned = " ".join(value.split()) if label == "Title" else value.strip()
    if len(cleaned) < minimum:
        raise CommunityRuleError(f"{label} must contain at least {minimum} characters.")
    if len(cleaned) > maximum:
        raise CommunityRuleError(f"{label} cannot exceed {maximum} characters.")
    if "\x00" in cleaned:
        raise CommunityRuleError(f"{label} contains unsupported characters.")
    if len(_URL_PATTERN.findall(cleaned)) > 5:
        raise CommunityRuleError(f"{label} contains too many links.")
    return cleaned


def _body_digest(body: str) -> str:
    normalized = " ".join(body.lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _window_start(*, now: datetime, seconds: int) -> datetime:
    timestamp = int(now.timestamp())
    return datetime.fromtimestamp(timestamp - (timestamp % seconds), tz=now.tzinfo)


def consume_rate_limit(*, user: User, action: str) -> None:
    settings_by_action: dict[str, tuple[str, str, int, int]] = {
        CommunityRateBucket.Action.DISCUSSION_CREATE: (
            "COMMUNITY_DISCUSSION_RATE_WINDOW_SECONDS",
            "COMMUNITY_DISCUSSION_RATE_LIMIT",
            300,
            5,
        ),
        CommunityRateBucket.Action.COMMENT_CREATE: (
            "COMMUNITY_COMMENT_RATE_WINDOW_SECONDS",
            "COMMUNITY_COMMENT_RATE_LIMIT",
            300,
            20,
        ),
        CommunityRateBucket.Action.CONTENT_EDIT: (
            "COMMUNITY_EDIT_RATE_WINDOW_SECONDS",
            "COMMUNITY_EDIT_RATE_LIMIT",
            300,
            30,
        ),
    }
    if action not in settings_by_action:
        raise CommunityRuleError("Unsupported community action.")
    window_name, limit_name, default_window, default_limit = settings_by_action[action]
    window_seconds = int(getattr(settings, window_name, default_window))
    limit = int(getattr(settings, limit_name, default_limit))
    now = timezone.now()
    bucket, created = CommunityRateBucket.objects.get_or_create(
        user=user,
        action=action,
        window_started_at=_window_start(now=now, seconds=window_seconds),
        defaults={"count": 1},
    )
    if created:
        return
    updated = CommunityRateBucket.objects.filter(id=bucket.id, count__lt=limit).update(
        count=F("count") + 1
    )
    if updated == 0:
        raise CommunityRateLimitError("Too many community actions. Please wait and try again.")


def _assert_not_duplicate_discussion(*, author: User, digest: str) -> None:
    since = timezone.now() - timedelta(minutes=10)
    if Discussion.objects.filter(
        author=author,
        body_digest=digest,
        status__in=(Discussion.Status.ACTIVE, Discussion.Status.LOCKED),
        created_at__gte=since,
    ).exists():
        raise CommunityRuleError("That discussion was already posted recently.")


def _assert_not_duplicate_comment(*, author: User, discussion: Discussion, digest: str) -> None:
    since = timezone.now() - timedelta(minutes=5)
    if Comment.objects.filter(
        author=author,
        discussion=discussion,
        body_digest=digest,
        status=Comment.Status.ACTIVE,
        created_at__gte=since,
    ).exists():
        raise CommunityRuleError("That reply was already posted recently.")


@transaction.atomic
def create_discussion(
    *,
    actor: User,
    context_type: str,
    context_id: UUID,
    title: str,
    body: str,
    client_request_id: UUID,
    space_id: UUID | None = None,
) -> Discussion:
    clean_title = _clean_text(title, label="Title", minimum=8, maximum=220)
    clean_body = _clean_text(body, label="Discussion", minimum=20, maximum=10_000)
    existing = Discussion.objects.filter(
        author=actor,
        client_request_id=client_request_id,
    ).first()
    if existing is not None:
        same_request = (
            existing.context_type == context_type
            and existing.context_id == context_id
            and existing.space_id == space_id
            and existing.title == clean_title
            and existing.body == clean_body
        )
        if not same_request:
            raise CommunityConflictError("That request identifier is already in use.")
        return existing

    try:
        context = resolve_context(user=actor, context_type=context_type, context_id=context_id)
    except CommunityContextError as error:
        raise CommunityRuleError(str(error)) from error
    space = None
    if space_id is not None:
        try:
            space = CommunitySpace.objects.select_related("owner").get(id=space_id)
        except CommunitySpace.DoesNotExist as error:
            raise CommunityRuleError("Creator space not found.") from error
        if not can_create_in_space(user=actor, space=space):
            raise CommunityRuleError("You cannot post in this creator space.")
        if space.context_type != context_type or space.context_id != context_id:
            raise CommunityRuleError("Discussion context must match the creator space.")

    digest = _body_digest(clean_body)
    _assert_not_duplicate_discussion(author=actor, digest=digest)
    consume_rate_limit(user=actor, action=CommunityRateBucket.Action.DISCUSSION_CREATE)
    discussion = Discussion.objects.create(
        author=actor,
        space=space,
        context_type=context.context_type,
        context_id=context.context_id,
        context_title=context.title,
        context_route=context.route,
        title=clean_title,
        body=clean_body,
        body_digest=digest,
        client_request_id=client_request_id,
    )
    DiscussionRevision.objects.create(
        discussion=discussion,
        editor=actor,
        revision=1,
        title=clean_title,
        body=clean_body,
        reason=DiscussionRevision.Reason.CREATED,
    )
    publish_after_commit(
        DiscussionCreated(
            discussion_id=discussion.id,
            author_id=actor.id,
            context_type=discussion.context_type,
            context_id=discussion.context_id,
            space_id=discussion.space_id,
            actor_id=actor.id,
        )
    )
    return discussion


@transaction.atomic
def edit_discussion(
    *, actor: User, discussion_id: UUID, expected_revision: int, title: str, body: str
) -> Discussion:
    discussion = (
        Discussion.objects.select_for_update(of=("self",))
        .select_related("space")
        .get(id=discussion_id)
    )
    if not can_edit_discussion(user=actor, discussion=discussion):
        raise CommunityRuleError("You cannot edit this discussion.")
    if discussion.revision != expected_revision:
        raise CommunityConflictError("This discussion changed. Reload it and try again.")
    clean_title = _clean_text(title, label="Title", minimum=8, maximum=220)
    clean_body = _clean_text(body, label="Discussion", minimum=20, maximum=10_000)
    consume_rate_limit(user=actor, action=CommunityRateBucket.Action.CONTENT_EDIT)
    discussion.title = clean_title
    discussion.body = clean_body
    discussion.body_digest = _body_digest(clean_body)
    discussion.revision += 1
    discussion.save(update_fields=("title", "body", "body_digest", "revision", "updated_at"))
    DiscussionRevision.objects.create(
        discussion=discussion,
        editor=actor,
        revision=discussion.revision,
        title=clean_title,
        body=clean_body,
        reason=DiscussionRevision.Reason.EDITED,
    )
    publish_after_commit(
        CommunityContentChanged(
            target_type="discussion",
            target_id=discussion.id,
            discussion_id=discussion.id,
            action="edited",
            owner_id=discussion.author_id,
            actor_id=actor.id,
        )
    )
    return discussion


@transaction.atomic
def delete_own_discussion(
    *, actor: User, discussion_id: UUID, expected_revision: int
) -> Discussion:
    discussion = (
        Discussion.objects.select_for_update(of=("self",))
        .select_related("space")
        .get(id=discussion_id)
    )
    if discussion.author_id != actor.id or discussion.status != Discussion.Status.ACTIVE:
        raise CommunityRuleError("You cannot delete this discussion.")
    if discussion.revision != expected_revision:
        raise CommunityConflictError("This discussion changed. Reload it and try again.")
    discussion.status = Discussion.Status.AUTHOR_DELETED
    discussion.deleted_at = timezone.now()
    discussion.revision += 1
    discussion.save(update_fields=("status", "deleted_at", "revision", "updated_at"))
    DiscussionRevision.objects.create(
        discussion=discussion,
        editor=actor,
        revision=discussion.revision,
        title=discussion.title,
        body=discussion.body,
        reason=DiscussionRevision.Reason.AUTHOR_DELETED,
    )
    publish_after_commit(
        CommunityContentChanged(
            target_type="discussion",
            target_id=discussion.id,
            discussion_id=discussion.id,
            action="author_deleted",
            owner_id=discussion.author_id,
            actor_id=actor.id,
        )
    )
    return discussion


@transaction.atomic
def create_comment(
    *,
    actor: User,
    discussion_id: UUID,
    body: str,
    client_request_id: UUID,
    parent_id: UUID | None = None,
) -> Comment:
    clean_body = _clean_text(body, label="Reply", minimum=3, maximum=6000)
    existing = Comment.objects.filter(author=actor, client_request_id=client_request_id).first()
    if existing is not None:
        same_request = (
            existing.discussion_id == discussion_id
            and existing.parent_id == parent_id
            and existing.body == clean_body
        )
        if not same_request:
            raise CommunityConflictError("That request identifier is already in use.")
        return existing
    try:
        discussion = (
            Discussion.objects.select_for_update(of=("self",))
            .select_related("space")
            .get(id=discussion_id)
        )
    except Discussion.DoesNotExist as error:
        raise CommunityRuleError("Discussion not found.") from error
    if not can_view_discussion(user=actor, discussion=discussion):
        raise CommunityRuleError("Discussion not found.")
    if discussion.status != Discussion.Status.ACTIVE:
        raise CommunityRuleError("This discussion is not accepting replies.")

    parent = None
    if parent_id is not None:
        try:
            parent = Comment.objects.get(id=parent_id, discussion=discussion)
        except Comment.DoesNotExist as error:
            raise CommunityRuleError("Parent reply not found.") from error
        if parent.parent_id is not None:
            raise CommunityRuleError("Replies can be nested one level only.")
        if parent.status != Comment.Status.ACTIVE:
            raise CommunityRuleError("You cannot reply to a removed comment.")

    digest = _body_digest(clean_body)
    _assert_not_duplicate_comment(author=actor, discussion=discussion, digest=digest)
    consume_rate_limit(user=actor, action=CommunityRateBucket.Action.COMMENT_CREATE)
    comment = Comment.objects.create(
        discussion=discussion,
        parent=parent,
        author=actor,
        body=clean_body,
        body_digest=digest,
        client_request_id=client_request_id,
    )
    CommentRevision.objects.create(
        comment=comment,
        editor=actor,
        revision=1,
        body=clean_body,
        reason=CommentRevision.Reason.CREATED,
    )
    now = timezone.now()
    Discussion.objects.filter(id=discussion.id).update(
        comment_count=F("comment_count") + 1,
        last_activity_at=now,
        updated_at=now,
    )
    publish_after_commit(
        DiscussionReplyCreated(
            comment_id=comment.id,
            discussion_id=discussion.id,
            author_id=actor.id,
            discussion_author_id=discussion.author_id,
            parent_comment_id=parent.id if parent is not None else None,
            parent_author_id=parent.author_id if parent is not None else None,
            context_type=discussion.context_type,
            context_id=discussion.context_id,
            space_id=discussion.space_id,
            actor_id=actor.id,
        )
    )
    return comment


@transaction.atomic
def edit_comment(*, actor: User, comment_id: UUID, expected_revision: int, body: str) -> Comment:
    comment = (
        Comment.objects.select_for_update(of=("self",))
        .select_related("discussion", "discussion__space")
        .get(id=comment_id)
    )
    if comment.author_id != actor.id or comment.status != Comment.Status.ACTIVE:
        raise CommunityRuleError("You cannot edit this reply.")
    if comment.revision != expected_revision:
        raise CommunityConflictError("This reply changed. Reload it and try again.")
    clean_body = _clean_text(body, label="Reply", minimum=3, maximum=6000)
    consume_rate_limit(user=actor, action=CommunityRateBucket.Action.CONTENT_EDIT)
    comment.body = clean_body
    comment.body_digest = _body_digest(clean_body)
    comment.revision += 1
    comment.save(update_fields=("body", "body_digest", "revision", "updated_at"))
    CommentRevision.objects.create(
        comment=comment,
        editor=actor,
        revision=comment.revision,
        body=clean_body,
        reason=CommentRevision.Reason.EDITED,
    )
    publish_after_commit(
        CommunityContentChanged(
            target_type="comment",
            target_id=comment.id,
            discussion_id=comment.discussion_id,
            action="edited",
            owner_id=comment.author_id,
            actor_id=actor.id,
        )
    )
    return comment


@transaction.atomic
def delete_own_comment(*, actor: User, comment_id: UUID, expected_revision: int) -> Comment:
    comment = Comment.objects.select_for_update().select_related("discussion").get(id=comment_id)
    if comment.author_id != actor.id or comment.status != Comment.Status.ACTIVE:
        raise CommunityRuleError("You cannot delete this reply.")
    if comment.revision != expected_revision:
        raise CommunityConflictError("This reply changed. Reload it and try again.")
    comment.status = Comment.Status.AUTHOR_DELETED
    comment.deleted_at = timezone.now()
    comment.revision += 1
    comment.save(update_fields=("status", "deleted_at", "revision", "updated_at"))
    CommentRevision.objects.create(
        comment=comment,
        editor=actor,
        revision=comment.revision,
        body=comment.body,
        reason=CommentRevision.Reason.AUTHOR_DELETED,
    )
    publish_after_commit(
        CommunityContentChanged(
            target_type="comment",
            target_id=comment.id,
            discussion_id=comment.discussion_id,
            action="author_deleted",
            owner_id=comment.author_id,
            actor_id=actor.id,
        )
    )
    return comment


@transaction.atomic
def create_space(
    *, actor: User, context_type: str, context_id: UUID, title: str, description: str
) -> CommunitySpace:
    try:
        context = resolve_context(user=actor, context_type=context_type, context_id=context_id)
    except CommunityContextError as error:
        raise CommunityRuleError(str(error)) from error
    if not can_create_space_for_context(user=actor, context=context):
        raise CommunityRuleError("You cannot create a space for this learning context.")
    clean_title = _clean_text(title, label="Title", minimum=5, maximum=180)
    clean_description = description.strip()
    if len(clean_description) > 4000:
        raise CommunityRuleError("Description cannot exceed 4000 characters.")
    existing = CommunitySpace.objects.filter(
        owner=actor,
        context_type=context_type,
        context_id=context_id,
    ).first()
    if existing is not None:
        return existing
    return CommunitySpace.objects.create(
        owner=actor,
        context_type=context.context_type,
        context_id=context.context_id,
        context_title=context.title,
        context_route=context.route,
        title=clean_title,
        description=clean_description,
    )


@transaction.atomic
def set_space_member(*, actor: User, space_id: UUID, user: User, role: str) -> SpaceMembership:
    if role not in SpaceMembership.Role.values:
        raise CommunityRuleError("Unsupported creator-space role.")
    space = CommunitySpace.objects.select_for_update().get(id=space_id)
    if not can_manage_space(user=actor, space=space):
        raise CommunityRuleError("You cannot manage this creator space.")
    if user.id == space.owner_id:
        raise CommunityRuleError("The space owner does not need a membership record.")
    membership, created = SpaceMembership.objects.get_or_create(
        space=space,
        user=user,
        defaults={"role": role, "status": SpaceMembership.Status.ACTIVE, "invited_by": actor},
    )
    action = SpaceMembershipHistory.Action.INVITED
    if not created:
        action = (
            SpaceMembershipHistory.Action.RESTORED
            if membership.status == SpaceMembership.Status.REVOKED
            else SpaceMembershipHistory.Action.ROLE_CHANGED
        )
        membership.role = role
        membership.status = SpaceMembership.Status.ACTIVE
        membership.revoked_at = None
        membership.invited_by = actor
        membership.save(update_fields=("role", "status", "revoked_at", "invited_by", "updated_at"))
    SpaceMembershipHistory.objects.create(
        space=space,
        membership=membership,
        actor=actor,
        action=action,
        role=role,
    )
    publish_after_commit(
        CreatorSpaceMembershipChanged(
            space_id=space.id,
            user_id=user.id,
            action=action,
            role=role,
            actor_id=actor.id,
        )
    )
    return membership


@transaction.atomic
def revoke_space_member(*, actor: User, space_id: UUID, user_id: UUID) -> SpaceMembership:
    space = CommunitySpace.objects.select_for_update().get(id=space_id)
    if not can_manage_space(user=actor, space=space):
        raise CommunityRuleError("You cannot manage this creator space.")
    membership = SpaceMembership.objects.select_for_update().get(space=space, user_id=user_id)
    if membership.status == SpaceMembership.Status.REVOKED:
        return membership
    membership.status = SpaceMembership.Status.REVOKED
    membership.revoked_at = timezone.now()
    membership.save(update_fields=("status", "revoked_at", "updated_at"))
    SpaceMembershipHistory.objects.create(
        space=space,
        membership=membership,
        actor=actor,
        action=SpaceMembershipHistory.Action.REVOKED,
        role=membership.role,
    )
    publish_after_commit(
        CreatorSpaceMembershipChanged(
            space_id=space.id,
            user_id=membership.user_id,
            action="revoked",
            role=membership.role,
            actor_id=actor.id,
        )
    )
    return membership


@transaction.atomic
def moderate_content(
    *, actor: User, target_type: str, target_id: UUID, action: str, reason: str
) -> Discussion | Comment:
    note = reason.strip()
    if len(note) < 10 or len(note) > 4000:
        raise CommunityRuleError("A moderation reason between 10 and 4000 characters is required.")
    if target_type == "discussion":
        discussion_target = (
            Discussion.objects.select_for_update(of=("self",))
            .select_related("space")
            .get(id=target_id)
        )
        if not can_remove_discussion(user=actor, discussion=discussion_target):
            raise CommunityRuleError("You cannot moderate this discussion.")
        if action == "remove":
            discussion_target.status = Discussion.Status.MODERATOR_REMOVED
            discussion_target.deleted_at = timezone.now()
            discussion_reason = DiscussionRevision.Reason.MODERATOR_REMOVED
        elif action == "restore":
            if discussion_target.status != Discussion.Status.MODERATOR_REMOVED:
                raise CommunityRuleError("Only moderator-removed discussions can be restored.")
            discussion_target.status = Discussion.Status.ACTIVE
            discussion_target.deleted_at = None
            discussion_reason = DiscussionRevision.Reason.RESTORED
        elif action in ("lock", "unlock"):
            discussion_target.status = (
                Discussion.Status.LOCKED if action == "lock" else Discussion.Status.ACTIVE
            )
            discussion_target.deleted_at = None
            discussion_reason = (
                DiscussionRevision.Reason.LOCKED
                if action == "lock"
                else DiscussionRevision.Reason.UNLOCKED
            )
        else:
            raise CommunityRuleError("Unsupported moderation action.")
        discussion_target.removal_reason = note if action == "remove" else ""
        discussion_target.revision += 1
        discussion_target.save(
            update_fields=("status", "deleted_at", "removal_reason", "revision", "updated_at")
        )
        DiscussionRevision.objects.create(
            discussion=discussion_target,
            editor=actor,
            revision=discussion_target.revision,
            title=discussion_target.title,
            body=discussion_target.body,
            reason=discussion_reason,
            note=note,
        )
        result: Discussion | Comment = discussion_target
        discussion_id = discussion_target.id
        owner_id = discussion_target.author_id
    elif target_type == "comment":
        comment_target = (
            Comment.objects.select_for_update(of=("self",))
            .select_related("discussion", "discussion__space")
            .get(id=target_id)
        )
        discussion = comment_target.discussion
        if discussion.space_id is None:
            from .policies import is_global_moderator

            permitted = is_global_moderator(actor)
        else:
            space = discussion.space
            permitted = space is not None and can_moderate_space(user=actor, space=space)
        if not permitted:
            raise CommunityRuleError("You cannot moderate this reply.")
        if action == "remove":
            comment_target.status = Comment.Status.MODERATOR_REMOVED
            comment_target.deleted_at = timezone.now()
            comment_reason = CommentRevision.Reason.MODERATOR_REMOVED
        elif action == "restore":
            if comment_target.status != Comment.Status.MODERATOR_REMOVED:
                raise CommunityRuleError("Only moderator-removed replies can be restored.")
            comment_target.status = Comment.Status.ACTIVE
            comment_target.deleted_at = None
            comment_reason = CommentRevision.Reason.RESTORED
        else:
            raise CommunityRuleError("Unsupported moderation action.")
        comment_target.removal_reason = note if action == "remove" else ""
        comment_target.revision += 1
        comment_target.save(
            update_fields=("status", "deleted_at", "removal_reason", "revision", "updated_at")
        )
        CommentRevision.objects.create(
            comment=comment_target,
            editor=actor,
            revision=comment_target.revision,
            body=comment_target.body,
            reason=comment_reason,
            note=note,
        )
        result = comment_target
        discussion_id = comment_target.discussion_id
        owner_id = comment_target.author_id
    else:
        raise CommunityRuleError("Unsupported community target.")
    publish_after_commit(
        CommunityContentChanged(
            target_type=target_type,
            target_id=result.id,
            discussion_id=discussion_id,
            action=action,
            owner_id=owner_id,
            actor_id=actor.id,
        )
    )
    return result

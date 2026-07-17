import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class LearningContextType(models.TextChoices):
    LESSON = "lesson", "Lesson"
    LEARNING_OBJECT = "learning_object", "Learning object"
    QUESTION = "question", "Question"
    QUIZ = "quiz", "Quiz"


class CommunitySpace(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_community_spaces",
    )
    context_type = models.CharField(max_length=24, choices=LearningContextType.choices)
    context_id = models.UUIDField()
    context_title = models.CharField(max_length=220)
    context_route = models.CharField(max_length=300)
    title = models.CharField(max_length=180)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    revision = models.PositiveBigIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("owner", "context_type", "context_id"),
                name="community_space_owner_context_unique",
            )
        ]
        indexes = [
            models.Index(fields=("owner", "status", "-updated_at"), name="space_owner_status_idx"),
            models.Index(
                fields=("context_type", "context_id", "status"),
                name="space_context_status_idx",
            ),
        ]

    def __str__(self) -> str:
        return self.title


class SpaceMembership(models.Model):
    class Role(models.TextChoices):
        MEMBER = "member", "Member"
        MODERATOR = "moderator", "Space moderator"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        REVOKED = "revoked", "Revoked"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    space = models.ForeignKey(
        CommunitySpace,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="community_space_memberships",
    )
    role = models.CharField(max_length=12, choices=Role.choices, default=Role.MEMBER)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="community_membership_invitations",
    )
    joined_at = models.DateTimeField(default=timezone.now)
    revoked_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("joined_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("space", "user"),
                name="community_space_member_unique",
            ),
            models.CheckConstraint(
                condition=(
                    Q(status="active", revoked_at__isnull=True)
                    | Q(status="revoked", revoked_at__isnull=False)
                ),
                name="community_membership_status_consistent",
            ),
        ]
        indexes = [
            models.Index(fields=("user", "status", "space"), name="space_member_user_idx"),
            models.Index(fields=("space", "status", "role"), name="space_member_scope_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.space_id}:{self.user_id}:{self.status}"


class SpaceMembershipHistory(models.Model):
    class Action(models.TextChoices):
        INVITED = "invited", "Invited"
        ROLE_CHANGED = "role_changed", "Role changed"
        REVOKED = "revoked", "Revoked"
        RESTORED = "restored", "Restored"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    space = models.ForeignKey(
        CommunitySpace,
        on_delete=models.PROTECT,
        related_name="membership_history",
    )
    membership = models.ForeignKey(
        SpaceMembership,
        on_delete=models.PROTECT,
        related_name="history",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="community_membership_actions",
    )
    action = models.CharField(max_length=16, choices=Action.choices)
    role = models.CharField(max_length=12, choices=SpaceMembership.Role.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")
        indexes = [models.Index(fields=("space", "created_at"), name="space_history_time_idx")]

    def __str__(self) -> str:
        return f"{self.membership_id}:{self.action}"


class Discussion(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        LOCKED = "locked", "Locked"
        AUTHOR_DELETED = "author_deleted", "Deleted by author"
        MODERATOR_REMOVED = "moderator_removed", "Removed by moderator"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="community_discussions",
    )
    space = models.ForeignKey(
        CommunitySpace,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="discussions",
    )
    context_type = models.CharField(max_length=24, choices=LearningContextType.choices)
    context_id = models.UUIDField()
    context_title = models.CharField(max_length=220)
    context_route = models.CharField(max_length=300)
    title = models.CharField(max_length=220)
    body = models.TextField()
    body_digest = models.CharField(max_length=64, editable=False)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    removal_reason = models.TextField(blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    comment_count = models.PositiveBigIntegerField(default=0)
    client_request_id = models.UUIDField()
    last_activity_at = models.DateTimeField(default=timezone.now)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-last_activity_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("author", "client_request_id"),
                name="discussion_author_request_unique",
            ),
            models.CheckConstraint(
                condition=(
                    Q(status__in=("active", "locked"), deleted_at__isnull=True)
                    | Q(
                        status__in=("author_deleted", "moderator_removed"),
                        deleted_at__isnull=False,
                    )
                ),
                name="discussion_delete_status_consistent",
            ),
        ]
        indexes = [
            models.Index(
                fields=("context_type", "context_id", "status", "-last_activity_at"),
                name="discussion_context_feed_idx",
            ),
            models.Index(
                fields=("space", "status", "-last_activity_at"),
                name="discussion_space_feed_idx",
            ),
            models.Index(
                fields=("author", "status", "-updated_at"),
                name="discussion_author_state_idx",
            ),
            models.Index(
                fields=("author", "body_digest", "-created_at"),
                name="discussion_duplicate_idx",
            ),
        ]

    def __str__(self) -> str:
        return self.title


class DiscussionRevision(models.Model):
    class Reason(models.TextChoices):
        CREATED = "created", "Created"
        EDITED = "edited", "Edited"
        AUTHOR_DELETED = "author_deleted", "Deleted by author"
        MODERATOR_REMOVED = "moderator_removed", "Removed by moderator"
        RESTORED = "restored", "Restored"
        LOCKED = "locked", "Locked"
        UNLOCKED = "unlocked", "Unlocked"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    discussion = models.ForeignKey(
        Discussion,
        on_delete=models.PROTECT,
        related_name="revisions",
    )
    editor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="discussion_revisions",
    )
    revision = models.PositiveBigIntegerField()
    title = models.CharField(max_length=220)
    body = models.TextField()
    reason = models.CharField(max_length=20, choices=Reason.choices)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("revision",)
        constraints = [
            models.UniqueConstraint(
                fields=("discussion", "revision"),
                name="discussion_revision_unique",
            )
        ]

    def __str__(self) -> str:
        return f"{self.discussion_id}:r{self.revision}"


class Comment(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        AUTHOR_DELETED = "author_deleted", "Deleted by author"
        MODERATOR_REMOVED = "moderator_removed", "Removed by moderator"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    discussion = models.ForeignKey(
        Discussion,
        on_delete=models.PROTECT,
        related_name="comments",
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="replies",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="community_comments",
    )
    body = models.TextField()
    body_digest = models.CharField(max_length=64, editable=False)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    removal_reason = models.TextField(blank=True)
    revision = models.PositiveBigIntegerField(default=1)
    client_request_id = models.UUIDField()
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("author", "client_request_id"),
                name="comment_author_request_unique",
            ),
            models.CheckConstraint(
                condition=(
                    Q(status="active", deleted_at__isnull=True)
                    | Q(
                        status__in=("author_deleted", "moderator_removed"),
                        deleted_at__isnull=False,
                    )
                ),
                name="comment_delete_status_consistent",
            ),
        ]
        indexes = [
            models.Index(
                fields=("discussion", "status", "created_at", "id"),
                name="comment_discussion_feed_idx",
            ),
            models.Index(fields=("parent", "status", "created_at"), name="comment_reply_feed_idx"),
            models.Index(
                fields=("author", "body_digest", "-created_at"),
                name="comment_duplicate_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.discussion_id}:{self.id}"


class CommentRevision(models.Model):
    class Reason(models.TextChoices):
        CREATED = "created", "Created"
        EDITED = "edited", "Edited"
        AUTHOR_DELETED = "author_deleted", "Deleted by author"
        MODERATOR_REMOVED = "moderator_removed", "Removed by moderator"
        RESTORED = "restored", "Restored"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    comment = models.ForeignKey(Comment, on_delete=models.PROTECT, related_name="revisions")
    editor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="comment_revisions",
    )
    revision = models.PositiveBigIntegerField()
    body = models.TextField()
    reason = models.CharField(max_length=20, choices=Reason.choices)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("revision",)
        constraints = [
            models.UniqueConstraint(
                fields=("comment", "revision"),
                name="comment_revision_unique",
            )
        ]

    def __str__(self) -> str:
        return f"{self.comment_id}:r{self.revision}"


class CommunityRateBucket(models.Model):
    class Action(models.TextChoices):
        DISCUSSION_CREATE = "discussion_create", "Create discussion"
        COMMENT_CREATE = "comment_create", "Create comment"
        CONTENT_EDIT = "content_edit", "Edit content"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="community_rate_buckets",
    )
    action = models.CharField(max_length=24, choices=Action.choices)
    window_started_at = models.DateTimeField()
    count = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "action", "window_started_at"),
                name="community_rate_bucket_unique",
            )
        ]
        indexes = [
            models.Index(fields=("action", "window_started_at"), name="community_rate_cleanup_idx")
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.action}:{self.window_started_at.isoformat()}"

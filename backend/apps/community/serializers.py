from typing import Any

from rest_framework import serializers

from apps.accounts.avatars import AvatarPayload, avatar_payload
from apps.accounts.models import User
from apps.accounts.roles import Role
from platform_core.api.serializers import StrictSerializer

from .models import Comment, CommunitySpace, Discussion, LearningContextType, SpaceMembership
from .policies import can_edit_discussion, can_manage_space


def _author_badges(user: User) -> list[str]:
    cached_groups = getattr(user, "_prefetched_objects_cache", {}).get("groups")
    names = (
        {group.name for group in cached_groups}
        if cached_groups is not None
        else set(user.groups.values_list("name", flat=True))
    )
    if user.is_superuser:
        names.add(Role.ADMINISTRATOR.value)
    return [role.value for role in Role if role is not Role.STUDENT and role.value in names]


def _request_user(context: dict[str, Any]) -> User | None:
    request = context.get("request")
    user = getattr(request, "user", None)
    return user if isinstance(user, User) else None


class AuthorSerializer(serializers.ModelSerializer[User]):
    badges = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "full_name", "avatar", "badges")
        read_only_fields = fields

    def get_badges(self, user: User) -> list[str]:
        return _author_badges(user)

    def get_avatar(self, user: User) -> AvatarPayload:
        return avatar_payload(user)


class DiscussionSerializer(serializers.ModelSerializer[Discussion]):
    author = AuthorSerializer(read_only=True)
    title = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    space_title = serializers.CharField(source="space.title", read_only=True, allow_null=True)

    class Meta:
        model = Discussion
        fields = (
            "id",
            "author",
            "space_id",
            "space_title",
            "context_type",
            "context_id",
            "context_title",
            "context_route",
            "title",
            "body",
            "status",
            "revision",
            "comment_count",
            "last_activity_at",
            "created_at",
            "updated_at",
            "can_edit",
            "can_delete",
        )
        read_only_fields = fields

    def get_title(self, discussion: Discussion) -> str | None:
        return (
            discussion.title
            if discussion.status in (Discussion.Status.ACTIVE, Discussion.Status.LOCKED)
            else None
        )

    def get_body(self, discussion: Discussion) -> str | None:
        return (
            discussion.body
            if discussion.status in (Discussion.Status.ACTIVE, Discussion.Status.LOCKED)
            else None
        )

    def get_can_edit(self, discussion: Discussion) -> bool:
        user = _request_user(self.context)
        return user is not None and can_edit_discussion(user=user, discussion=discussion)

    def get_can_delete(self, discussion: Discussion) -> bool:
        user = _request_user(self.context)
        return (
            user is not None
            and discussion.author_id == user.id
            and discussion.status == Discussion.Status.ACTIVE
        )


class CommentSerializer(serializers.ModelSerializer[Comment]):
    author = AuthorSerializer(read_only=True)
    body = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = (
            "id",
            "discussion_id",
            "parent_id",
            "author",
            "body",
            "status",
            "revision",
            "created_at",
            "updated_at",
            "can_edit",
            "can_delete",
        )
        read_only_fields = fields

    def get_body(self, comment: Comment) -> str | None:
        return comment.body if comment.status == Comment.Status.ACTIVE else None

    def get_can_edit(self, comment: Comment) -> bool:
        user = _request_user(self.context)
        return (
            user is not None
            and comment.author_id == user.id
            and comment.status == Comment.Status.ACTIVE
        )

    def get_can_delete(self, comment: Comment) -> bool:
        user = _request_user(self.context)
        if user is None:
            return False
        return comment.author_id == user.id and comment.status == Comment.Status.ACTIVE


class SpaceSerializer(serializers.ModelSerializer[CommunitySpace]):
    owner = AuthorSerializer(read_only=True)
    member_count = serializers.SerializerMethodField()
    membership_role = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()

    class Meta:
        model = CommunitySpace
        fields = (
            "id",
            "owner",
            "context_type",
            "context_id",
            "context_title",
            "context_route",
            "title",
            "description",
            "status",
            "revision",
            "member_count",
            "membership_role",
            "can_manage",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_member_count(self, space: CommunitySpace) -> int:
        return int(getattr(space, "active_member_count", 0)) + 1

    def get_membership_role(self, space: CommunitySpace) -> str | None:
        user = _request_user(self.context)
        if user is None:
            return None
        if space.owner_id == user.id:
            return "owner"
        memberships = getattr(space, "viewer_memberships", [])
        return memberships[0].role if memberships else None

    def get_can_manage(self, space: CommunitySpace) -> bool:
        user = _request_user(self.context)
        return user is not None and can_manage_space(user=user, space=space)


class DiscussionWriteSerializer(StrictSerializer):
    context_type = serializers.ChoiceField(choices=LearningContextType.choices)
    context_id = serializers.UUIDField()
    space_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    title = serializers.CharField(max_length=220, trim_whitespace=True)
    body = serializers.CharField(max_length=10_000, trim_whitespace=True)
    client_request_id = serializers.UUIDField()


class DiscussionEditSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    title = serializers.CharField(max_length=220, trim_whitespace=True)
    body = serializers.CharField(max_length=10_000, trim_whitespace=True)


class RevisionSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)


class CommentWriteSerializer(StrictSerializer):
    parent_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    body = serializers.CharField(max_length=6000, trim_whitespace=True)
    client_request_id = serializers.UUIDField()


class CommentEditSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    body = serializers.CharField(max_length=6000, trim_whitespace=True)


class SpaceWriteSerializer(StrictSerializer):
    context_type = serializers.ChoiceField(
        choices=(LearningContextType.LESSON, LearningContextType.LEARNING_OBJECT)
    )
    context_id = serializers.UUIDField()
    title = serializers.CharField(max_length=180, trim_whitespace=True)
    description = serializers.CharField(
        max_length=4000,
        trim_whitespace=True,
        required=False,
        default="",
    )


class SpaceMemberWriteSerializer(StrictSerializer):
    user_id = serializers.UUIDField(required=False)
    email = serializers.EmailField(required=False)
    role = serializers.ChoiceField(choices=SpaceMembership.Role.choices)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if bool(attrs.get("user_id")) == bool(attrs.get("email")):
            raise serializers.ValidationError(
                {"email": "Provide either a university email or a user identifier."}
            )
        return attrs

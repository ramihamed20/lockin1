from uuid import UUID

from django.db.models import Count, Prefetch, Q, QuerySet

from apps.accounts.models import User

from .models import Comment, CommunitySpace, Discussion, SpaceMembership
from .policies import is_administrator


def visible_discussions(
    *,
    user: User,
    context_type: str | None = None,
    context_id: UUID | None = None,
    space_id: UUID | None = None,
) -> QuerySet[Discussion]:
    queryset = Discussion.objects.select_related(
        "author", "author__profile_image", "space", "space__owner", "space__owner__profile_image"
    ).prefetch_related("author__groups")
    if space_id is None:
        queryset = queryset.filter(
            space__isnull=True,
            status__in=(Discussion.Status.ACTIVE, Discussion.Status.LOCKED),
        )
    else:
        space = visible_spaces(user=user).get(id=space_id)
        queryset = queryset.filter(space=space)
    if context_type is not None:
        queryset = queryset.filter(context_type=context_type)
    if context_id is not None:
        queryset = queryset.filter(context_id=context_id)
    return queryset.order_by("-last_activity_at", "-id")


def discussion_for_user(*, user: User, discussion_id: UUID) -> Discussion:
    public_or_member = (
        Q(space__isnull=True)
        | Q(space__owner=user)
        | Q(
            space__memberships__user=user,
            space__memberships__status=SpaceMembership.Status.ACTIVE,
        )
    )
    if is_administrator(user):
        public_or_member = Q()
    return (
        Discussion.objects.filter(public_or_member)
        .select_related("author", "space", "space__owner")
        .prefetch_related("author__groups")
        .distinct()
        .get(id=discussion_id)
    )


def discussion_comments(*, user: User, discussion: Discussion) -> QuerySet[Comment]:
    discussion_for_user(user=user, discussion_id=discussion.id)
    return (
        Comment.objects.filter(discussion=discussion)
        .select_related(
            "author",
            "author__profile_image",
            "parent",
            "parent__author",
            "parent__author__profile_image",
        )
        .prefetch_related("author__groups")
        .order_by("created_at", "id")
    )


def visible_spaces(*, user: User) -> QuerySet[CommunitySpace]:
    viewer_membership = SpaceMembership.objects.filter(
        user=user,
        status=SpaceMembership.Status.ACTIVE,
    )
    queryset = (
        CommunitySpace.objects.select_related("owner", "owner__profile_image")
        .prefetch_related(
            "owner__groups",
            Prefetch(
                "memberships",
                queryset=viewer_membership,
                to_attr="viewer_memberships",
            ),
        )
        .annotate(
            active_member_count=Count(
                "memberships",
                filter=Q(memberships__status=SpaceMembership.Status.ACTIVE),
                distinct=True,
            )
        )
    )
    if not is_administrator(user):
        queryset = queryset.filter(Q(owner=user) | Q(memberships__in=viewer_membership)).distinct()
    return queryset.order_by("-updated_at", "id")

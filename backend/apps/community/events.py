from dataclasses import dataclass
from uuid import UUID

from platform_core.events import DomainEvent


@dataclass(frozen=True, slots=True, kw_only=True)
class DiscussionCreated(DomainEvent):
    event_name = "community.discussion.created"

    discussion_id: UUID
    author_id: UUID
    context_type: str
    context_id: UUID
    space_id: UUID | None


@dataclass(frozen=True, slots=True, kw_only=True)
class DiscussionReplyCreated(DomainEvent):
    event_name = "community.reply.created"

    comment_id: UUID
    discussion_id: UUID
    author_id: UUID
    discussion_author_id: UUID
    parent_comment_id: UUID | None
    parent_author_id: UUID | None
    context_type: str
    context_id: UUID
    space_id: UUID | None


@dataclass(frozen=True, slots=True, kw_only=True)
class CommunityContentChanged(DomainEvent):
    event_name = "community.content.changed"

    target_type: str
    target_id: UUID
    discussion_id: UUID
    action: str
    owner_id: UUID


@dataclass(frozen=True, slots=True, kw_only=True)
class CreatorSpaceMembershipChanged(DomainEvent):
    event_name = "community.space.membership.changed"

    space_id: UUID
    user_id: UUID
    action: str
    role: str

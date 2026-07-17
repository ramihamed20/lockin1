from dataclasses import dataclass
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils.text import slugify

from apps.accounts.models import User
from apps.accounts.roles import Role, user_has_role
from apps.discovery.indexing import (
    remove_search_entry,
    replace_academic_path_prefix,
    set_academic_path_visibility,
    upsert_education_entry,
)

from .models import CreatorScope, EducationNode
from .policies import can_manage_hierarchy, is_administrator


class EducationRuleError(ValueError):
    pass


class EducationConflictError(EducationRuleError):
    pass


@dataclass(frozen=True, slots=True)
class ScopeCapabilities:
    can_create_content: bool = True
    can_review_content: bool = False
    can_publish_content: bool = False
    can_create_assessments: bool = False
    can_review_assessments: bool = False
    can_publish_assessments: bool = False
    can_manage_hierarchy: bool = False


def _normalized_slug(*, title: str, slug: str | None) -> str:
    value = slugify((slug or title).strip(), allow_unicode=True)
    if not value:
        raise EducationRuleError("A usable slug is required.")
    return value[:180]


def _node_path(*, node_id: UUID, parent: EducationNode | None) -> str:
    prefix = parent.path if parent is not None else "/"
    return f"{prefix}{node_id}/"


def _ensure_revision(*, node: EducationNode, expected_revision: int) -> None:
    if node.revision != expected_revision:
        raise EducationConflictError("This hierarchy node changed. Reload it and try again.")


def _sync_node_search(node: EducationNode) -> None:
    if node.is_discoverable and node.kind in {
        EducationNode.Kind.SUBJECT,
        EducationNode.Kind.LESSON,
    }:
        upsert_education_entry(
            resource_id=node.id,
            resource_kind=node.kind,
            title=node.title,
            summary=node.description,
            academic_path=node.path,
            language="und",
        )
    else:
        remove_search_entry(resource_kind=node.kind, resource_id=node.id)


def _refresh_subtree_discoverability(node: EducationNode) -> list[EducationNode]:
    subtree = list(EducationNode.objects.filter(path__startswith=node.path).order_by("depth"))
    if not subtree:
        return []
    parent_discoverable: dict[UUID | None, bool] = {}
    if node.parent_id is not None:
        parent_discoverable[node.parent_id] = bool(
            EducationNode.objects.only("is_discoverable").get(id=node.parent_id).is_discoverable
        )
    for item in subtree:
        parent_is_visible = item.parent_id is None or parent_discoverable.get(item.parent_id, False)
        item.is_discoverable = item.status == EducationNode.Status.PUBLISHED and parent_is_visible
        parent_discoverable[item.id] = item.is_discoverable
    EducationNode.objects.bulk_update(subtree, ("is_discoverable",))
    for item in subtree:
        set_academic_path_visibility(
            academic_path=item.path,
            is_discoverable=item.is_discoverable,
        )
        _sync_node_search(item)
    return subtree


@transaction.atomic
def create_node(
    *,
    actor: User,
    kind: str,
    title: str,
    parent: EducationNode | None,
    slug: str | None = None,
    description: str = "",
    position: int = 0,
) -> EducationNode:
    if not can_manage_hierarchy(user=actor, node=parent) and not (
        parent is None and is_administrator(actor)
    ):
        raise EducationRuleError("You cannot manage this hierarchy location.")
    node = EducationNode(
        parent=parent,
        kind=kind,
        title=title,
        slug=_normalized_slug(title=title, slug=slug),
        description=description,
        position=position,
        depth=0 if parent is None else parent.depth + 1,
    )
    node.path = _node_path(node_id=node.id, parent=parent)
    try:
        node.full_clean()
        node.save()
    except (IntegrityError, ValidationError) as error:
        raise EducationRuleError(
            "That hierarchy node conflicts with the current structure."
        ) from error
    return node


@transaction.atomic
def update_node(
    *,
    actor: User,
    node_id: UUID,
    expected_revision: int,
    title: str | None = None,
    slug: str | None = None,
    description: str | None = None,
    position: int | None = None,
) -> EducationNode:
    node = EducationNode.objects.select_for_update().get(id=node_id)
    if not can_manage_hierarchy(user=actor, node=node):
        raise EducationRuleError("You cannot manage this hierarchy node.")
    _ensure_revision(node=node, expected_revision=expected_revision)
    if title is not None:
        node.title = title
    if slug is not None:
        node.slug = _normalized_slug(title=node.title, slug=slug)
    if description is not None:
        node.description = description
    if position is not None:
        node.position = position
    node.revision += 1
    try:
        node.full_clean()
        node.save()
    except (IntegrityError, ValidationError) as error:
        raise EducationRuleError(
            "That hierarchy update conflicts with the current structure."
        ) from error
    _sync_node_search(node)
    return node


@transaction.atomic
def move_node(
    *,
    actor: User,
    node_id: UUID,
    new_parent_id: UUID | None,
    expected_revision: int,
    position: int = 0,
) -> EducationNode:
    node = EducationNode.objects.select_for_update().get(id=node_id)
    new_parent = (
        EducationNode.objects.select_for_update().get(id=new_parent_id)
        if new_parent_id is not None
        else None
    )
    if not can_manage_hierarchy(user=actor, node=node) or not can_manage_hierarchy(
        user=actor, node=new_parent
    ):
        raise EducationRuleError("You cannot move this hierarchy node.")
    _ensure_revision(node=node, expected_revision=expected_revision)
    if new_parent is not None and new_parent.path.startswith(node.path):
        raise EducationRuleError("A node cannot be moved into itself or one of its descendants.")
    if node.kind == EducationNode.Kind.INSTITUTION and new_parent is not None:
        raise EducationRuleError("An institution must remain a root node.")
    if node.kind != EducationNode.Kind.INSTITUTION and new_parent is None:
        raise EducationRuleError("Only an institution can be a root node.")

    old_path = node.path
    new_path = _node_path(node_id=node.id, parent=new_parent)
    depth_delta = (0 if new_parent is None else new_parent.depth + 1) - node.depth
    descendants = list(
        EducationNode.objects.select_for_update()
        .filter(path__startswith=old_path)
        .order_by("depth")
    )
    for item in descendants:
        item.path = new_path + item.path.removeprefix(old_path)
        item.depth += depth_delta
        if item.id == node.id:
            item.parent = new_parent
            item.position = position
            item.revision += 1
    EducationNode.objects.bulk_update(
        descendants,
        ("parent", "position", "path", "depth", "revision"),
    )
    replace_academic_path_prefix(old_prefix=old_path, new_prefix=new_path)
    node = EducationNode.objects.get(id=node.id)
    _refresh_subtree_discoverability(node)
    return node


@transaction.atomic
def set_node_status(
    *,
    actor: User,
    node_id: UUID,
    expected_revision: int,
    status: str,
) -> EducationNode:
    node = EducationNode.objects.select_for_update().select_related("parent").get(id=node_id)
    if not can_manage_hierarchy(user=actor, node=node):
        raise EducationRuleError("You cannot manage this hierarchy node.")
    _ensure_revision(node=node, expected_revision=expected_revision)
    if status not in {EducationNode.Status.PUBLISHED, EducationNode.Status.ARCHIVED}:
        raise EducationRuleError("Unsupported hierarchy state transition.")
    if (
        status == EducationNode.Status.PUBLISHED
        and node.parent is not None
        and not node.parent.is_discoverable
    ):
        raise EducationRuleError("Publish the parent path before publishing this node.")
    node.status = status
    node.revision += 1
    node.save(update_fields=("status", "revision", "updated_at"))
    _refresh_subtree_discoverability(node)
    return EducationNode.objects.get(id=node.id)


@transaction.atomic
def grant_creator_scope(
    *,
    actor: User,
    user: User,
    node: EducationNode,
    capabilities: ScopeCapabilities,
) -> CreatorScope:
    if not is_administrator(actor):
        raise EducationRuleError("Only administrators can grant creator scopes.")
    if not user_has_role(user, Role.CREATOR):
        raise EducationRuleError("The selected account must have the creator role first.")
    if not any(
        (
            capabilities.can_create_content,
            capabilities.can_review_content,
            capabilities.can_publish_content,
            capabilities.can_create_assessments,
            capabilities.can_review_assessments,
            capabilities.can_publish_assessments,
            capabilities.can_manage_hierarchy,
        )
    ):
        raise EducationRuleError("A creator scope needs at least one capability.")
    scope, _ = CreatorScope.objects.update_or_create(
        user=user,
        node=node,
        defaults={
            "can_create_content": capabilities.can_create_content,
            "can_review_content": capabilities.can_review_content,
            "can_publish_content": capabilities.can_publish_content,
            "can_create_assessments": capabilities.can_create_assessments,
            "can_review_assessments": capabilities.can_review_assessments,
            "can_publish_assessments": capabilities.can_publish_assessments,
            "can_manage_hierarchy": capabilities.can_manage_hierarchy,
            "granted_by": actor,
        },
    )
    return scope


@transaction.atomic
def revoke_creator_scope(*, actor: User, scope_id: UUID) -> None:
    if not is_administrator(actor):
        raise EducationRuleError("Only administrators can revoke creator scopes.")
    CreatorScope.objects.filter(id=scope_id).delete()

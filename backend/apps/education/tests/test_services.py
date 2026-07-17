import pytest
from django.contrib.auth.models import Group

from apps.accounts.roles import Role
from apps.discovery.models import SearchEntry

from ..models import CreatorScope, EducationNode
from ..policies import can_create_content
from ..services import (
    EducationConflictError,
    EducationRuleError,
    ScopeCapabilities,
    create_node,
    grant_creator_scope,
    move_node,
    set_node_status,
    update_node,
)
from .helpers import create_admin, create_creator, published_path

pytestmark = pytest.mark.django_db


def test_flexible_tree_allows_omitted_levels_and_builds_deterministic_paths() -> None:
    admin = create_admin()
    institution, subject, lesson = published_path(admin=admin)

    assert subject.parent == institution
    assert lesson.parent == subject
    assert subject.depth == 1
    assert lesson.path == f"/{institution.id}/{subject.id}/{lesson.id}/"
    assert lesson.is_discoverable
    assert SearchEntry.objects.filter(
        resource_kind=EducationNode.Kind.SUBJECT,
        resource_id=subject.id,
    ).exists()


def test_move_prevents_cycles_and_requires_current_revision() -> None:
    admin = create_admin()
    _, subject, lesson = published_path(admin=admin)

    with pytest.raises(EducationRuleError):
        move_node(
            actor=admin,
            node_id=subject.id,
            new_parent_id=lesson.id,
            expected_revision=subject.revision,
        )

    update_node(
        actor=admin,
        node_id=subject.id,
        expected_revision=subject.revision,
        title="Updated anatomy",
    )
    with pytest.raises(EducationConflictError):
        update_node(
            actor=admin,
            node_id=subject.id,
            expected_revision=subject.revision,
            title="Stale update",
        )


def test_scoped_creator_can_manage_descendant_content_but_not_sibling() -> None:
    admin = create_admin()
    creator = create_creator()
    institution, subject, lesson = published_path(admin=admin)
    sibling = create_node(
        actor=admin,
        parent=institution,
        kind=EducationNode.Kind.SUBJECT,
        title="Biochemistry",
    )
    grant_creator_scope(
        actor=admin,
        user=creator,
        node=subject,
        capabilities=ScopeCapabilities(can_create_content=True),
    )

    assert can_create_content(user=creator, node=lesson)
    assert not can_create_content(user=creator, node=sibling)
    assert CreatorScope.objects.filter(user=creator, node=subject).exists()


def test_scope_requires_creator_role_and_archive_hides_descendants() -> None:
    admin = create_admin()
    institution, subject, lesson = published_path(admin=admin)
    student = create_creator(email="temporary@example.com")
    Group.objects.get(name=Role.CREATOR.value).user_set.remove(student)

    with pytest.raises(EducationRuleError):
        grant_creator_scope(
            actor=admin,
            user=student,
            node=subject,
            capabilities=ScopeCapabilities(),
        )

    archived = set_node_status(
        actor=admin,
        node_id=subject.id,
        expected_revision=subject.revision,
        status=EducationNode.Status.ARCHIVED,
    )
    lesson.refresh_from_db()
    institution.refresh_from_db()
    assert archived.status == EducationNode.Status.ARCHIVED
    assert not lesson.is_discoverable
    assert institution.is_discoverable
    assert not SearchEntry.objects.filter(resource_id=lesson.id).exists()

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user

from ..models import EducationNode
from ..services import create_node
from .helpers import create_admin, create_creator, published_path

pytestmark = pytest.mark.django_db


def test_public_browse_returns_only_discoverable_children() -> None:
    admin = create_admin()
    student = create_user()
    institution, subject, _ = published_path(admin=admin)
    create_node(
        actor=admin,
        parent=institution,
        kind=EducationNode.Kind.SUBJECT,
        title="Private draft",
    )
    client = APIClient()
    client.force_authenticate(student)

    roots = client.get("/api/v1/education/nodes")
    children = client.get(f"/api/v1/education/nodes?parent={institution.id}")
    detail = client.get(f"/api/v1/education/nodes/{subject.id}")

    assert roots.status_code == children.status_code == detail.status_code == 200
    assert roots.json()["count"] == 1
    assert children.json()["count"] == 1
    assert children.json()["results"][0]["title"] == "Human Anatomy"
    assert [item["title"] for item in detail.json()["breadcrumbs"]] == [
        "Lock-in University",
        "Human Anatomy",
    ]


def test_student_cannot_use_management_hierarchy_api() -> None:
    student = create_user()
    client = APIClient()
    client.force_authenticate(student)

    response = client.post(
        "/api/v1/management/education/nodes",
        {"kind": "institution", "title": "Injected University"},
        format="json",
    )

    assert response.status_code == 403
    assert not EducationNode.objects.exists()


def test_administrator_manages_hierarchy_and_creator_scopes_through_api() -> None:
    admin = create_admin()
    creator = create_creator()
    client = APIClient()
    client.force_authenticate(admin)

    root_response = client.post(
        "/api/v1/management/education/nodes",
        {"kind": "institution", "title": "North University", "position": 2},
        format="json",
    )
    assert root_response.status_code == 201
    root = root_response.json()
    child_response = client.post(
        "/api/v1/management/education/nodes",
        {
            "parent_id": root["id"],
            "kind": "subject",
            "title": "General Biology",
            "description": "Foundation subject",
        },
        format="json",
    )
    assert child_response.status_code == 201
    child = child_response.json()

    listing = client.get("/api/v1/management/education/nodes?page_size=100")
    assert listing.status_code == 200
    assert listing.json()["count"] == 2

    updated_response = client.patch(
        f"/api/v1/management/education/nodes/{child['id']}",
        {
            "expected_revision": child["revision"],
            "title": "Integrated Biology",
            "position": 3,
        },
        format="json",
    )
    assert updated_response.status_code == 200
    updated = updated_response.json()
    stale = client.patch(
        f"/api/v1/management/education/nodes/{child['id']}",
        {"expected_revision": child["revision"], "title": "Stale change"},
        format="json",
    )
    assert stale.status_code == 409

    invalid_move = client.post(
        f"/api/v1/management/education/nodes/{root['id']}/move",
        {"expected_revision": root["revision"], "parent_id": child["id"], "position": 0},
        format="json",
    )
    assert invalid_move.status_code == 400

    published_root_response = client.post(
        f"/api/v1/management/education/nodes/{root['id']}/status",
        {"expected_revision": root["revision"], "status": "published"},
        format="json",
    )
    assert published_root_response.status_code == 200
    published_child_response = client.post(
        f"/api/v1/management/education/nodes/{child['id']}/status",
        {"expected_revision": updated["revision"], "status": "published"},
        format="json",
    )
    assert published_child_response.status_code == 200

    scope_response = client.post(
        "/api/v1/management/education/scopes",
        {
            "user_id": str(creator.id),
            "node_id": child["id"],
            "can_create_content": True,
            "can_review_content": True,
            "can_publish_content": False,
            "can_manage_hierarchy": True,
        },
        format="json",
    )
    assert scope_response.status_code == 201
    scopes = client.get("/api/v1/management/education/scopes")
    assert scopes.status_code == 200
    assert scopes.json()["scopes"][0]["user_email"] == creator.email
    revoked = client.delete(
        f"/api/v1/management/education/scopes/{scope_response.json()['id']}"
    )
    assert revoked.status_code == 204

    missing_public = client.get(
        "/api/v1/education/nodes/00000000-0000-0000-0000-000000000001"
    )
    invalid_parent = client.get("/api/v1/education/nodes?parent=not-a-uuid")
    assert missing_public.status_code == invalid_parent.status_code == 404

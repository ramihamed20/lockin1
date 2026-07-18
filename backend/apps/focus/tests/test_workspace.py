from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, published_path
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.focus.models import FocusAnnotation, FocusSession, FocusSessionActivity

pytestmark = pytest.mark.django_db


def _grant_focus(user: User) -> None:
    EntitlementGrant.objects.create(
        user=user,
        entitlement=EntitlementDefinition.objects.get(code="focus.workspace"),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
    )


def _workspace_fixture() -> tuple[User, User, str, str]:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    learning_object = published_pdf(actor=admin, node=lesson)
    assert learning_object.published_version is not None
    student = create_user(email="focus-student@example.com")
    _grant_focus(student)
    return admin, student, str(learning_object.id), str(learning_object.published_version_id)


def _client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _start(client: APIClient, version_id: str, *, instance_id: str | None = None):  # type: ignore[no-untyped-def]
    return client.post(
        "/api/v1/focus/sessions",
        {
            "document_version_id": version_id,
            "client_instance_id": instance_id or str(uuid4()),
            "planned_duration_seconds": 1800,
        },
        format="json",
    )


def _stroke(annotation_id: str, *, page: int = 1) -> dict[str, object]:
    return {
        "id": annotation_id,
        "page_number": page,
        "tool": "pen",
        "layer_key": "personal",
        "bounds": {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2},
        "payload": {
            "kind": "stroke",
            "samples": [
                {
                    "x": 0.1,
                    "y": 0.1,
                    "pointer": "pen",
                    "pressure": 0.5,
                    "tiltX": 0,
                    "tiltY": 0,
                    "timestamp": 1,
                },
                {
                    "x": 0.3,
                    "y": 0.3,
                    "pointer": "pen",
                    "pressure": 0.7,
                    "tiltX": 5,
                    "tiltY": -4,
                    "timestamp": 2,
                },
            ],
        },
        "color": "#f2c94c",
        "thickness": 2.5,
        "opacity": 1,
    }


def test_focus_document_and_session_start_are_private_and_idempotent() -> None:
    _, student, _, version_id = _workspace_fixture()
    client = _client(student)

    document = client.get(f"/api/v1/focus/documents/{version_id}")
    instance_id = str(uuid4())
    first = _start(client, version_id, instance_id=instance_id)
    repeated = _start(client, version_id, instance_id=instance_id)

    assert document.status_code == 200
    assert document.json()["document"]["view_url"].startswith("/api/v1/files/")
    assert document.json()["document"]["checksum_sha256"]
    assert document.json()["annotation_revision"] == 0
    assert first.status_code == 201
    assert repeated.status_code == 200
    assert first.json()["id"] == repeated.json()["id"]
    assert first.json()["workspace"]["document_version_id"] == version_id
    assert FocusSession.objects.filter(user=student).count() == 1


def test_focus_requires_server_entitlement_before_resolving_document() -> None:
    _, _, _, version_id = _workspace_fixture()
    unentitled = create_user(email="unentitled-focus@example.com")
    client = _client(unentitled)

    document = client.get(f"/api/v1/focus/documents/{version_id}")
    start = _start(client, version_id)

    assert document.status_code == 403
    assert start.status_code == 403
    assert not FocusSession.objects.filter(user=unentitled).exists()


def test_workspace_state_uses_optimistic_revision_and_immutable_page_count() -> None:
    _, student, _, version_id = _workspace_fixture()
    client = _client(student)
    started = _start(client, version_id).json()
    session_id = started["id"]
    payload = {
        "expected_revision": 1,
        "current_page": 5,
        "page_count": 120,
        "zoom": "1.50",
        "sidebar": "thumbnails",
        "active_tool": "highlighter",
        "layout": {"toolbar_collapsed": False, "reading_direction": "vertical"},
        "open_tabs": [version_id],
    }

    saved = client.patch(f"/api/v1/focus/sessions/{session_id}/workspace", payload, format="json")
    stale = client.patch(f"/api/v1/focus/sessions/{session_id}/workspace", payload, format="json")
    changed_count = client.patch(
        f"/api/v1/focus/sessions/{session_id}/workspace",
        {**payload, "expected_revision": 2, "page_count": 121},
        format="json",
    )

    assert saved.status_code == 200
    assert saved.json()["revision"] == 2
    assert saved.json()["current_page"] == 5
    assert stale.status_code == 409
    assert changed_count.status_code == 400


def test_annotation_sync_is_versioned_idempotent_and_never_mutates_pdf() -> None:
    _, student, _, version_id = _workspace_fixture()
    client = _client(student)
    document = client.get(f"/api/v1/focus/documents/{version_id}").json()["document"]
    initial_checksum = document["checksum_sha256"]
    annotation_id = str(uuid4())
    idempotency_key = str(uuid4())
    payload = {
        "expected_collection_revision": 0,
        "idempotency_key": idempotency_key,
        "annotations": [_stroke(annotation_id)],
        "deleted_ids": [],
    }

    saved = client.post(f"/api/v1/focus/documents/{version_id}/annotations", payload, format="json")
    replayed = client.post(
        f"/api/v1/focus/documents/{version_id}/annotations", payload, format="json"
    )
    stale = client.post(
        f"/api/v1/focus/documents/{version_id}/annotations",
        {
            **payload,
            "idempotency_key": str(uuid4()),
            "annotations": [_stroke(str(uuid4()))],
        },
        format="json",
    )
    loaded = client.get(f"/api/v1/focus/documents/{version_id}/annotations?pages=1,2")
    final_checksum = client.get(f"/api/v1/focus/documents/{version_id}").json()["document"][
        "checksum_sha256"
    ]

    assert saved.status_code == 200
    assert saved.json()["collection_revision"] == 1
    assert replayed.status_code == 200
    assert replayed.json()["replayed"] is True
    assert stale.status_code == 409
    assert loaded.status_code == 200
    assert loaded.json()["results"][0]["id"] == annotation_id
    assert FocusAnnotation.objects.get(id=annotation_id).payload["kind"] == "stroke"
    assert final_checksum == initial_checksum


def test_annotations_are_owner_scoped_and_invalid_geometry_fails_closed() -> None:
    _, student, _, version_id = _workspace_fixture()
    owner_client = _client(student)
    annotation_id = str(uuid4())
    response = owner_client.post(
        f"/api/v1/focus/documents/{version_id}/annotations",
        {
            "expected_collection_revision": 0,
            "idempotency_key": str(uuid4()),
            "annotations": [_stroke(annotation_id)],
            "deleted_ids": [],
        },
        format="json",
    )
    assert response.status_code == 200

    other = create_user(email="other-focus@example.com")
    _grant_focus(other)
    other_client = _client(other)
    private = other_client.get(f"/api/v1/focus/documents/{version_id}/annotations?pages=1")
    invalid = owner_client.post(
        f"/api/v1/focus/documents/{version_id}/annotations",
        {
            "expected_collection_revision": 1,
            "idempotency_key": str(uuid4()),
            "annotations": [
                {
                    **_stroke(str(uuid4())),
                    "bounds": {"x": 0.9, "y": 0.9, "width": 0.5, "height": 0.5},
                }
            ],
            "deleted_ids": [],
        },
        format="json",
    )

    assert private.status_code == 200
    assert private.json()["collection_revision"] == 0
    assert private.json()["count"] == 0
    assert private.json()["results"] == []
    assert invalid.status_code == 400
    assert FocusAnnotation.objects.filter(collection__user=student).count() == 1


def test_deleted_annotation_can_be_restored_by_undo_with_same_identity() -> None:
    _, student, _, version_id = _workspace_fixture()
    client = _client(student)
    annotation_id = str(uuid4())
    created = client.post(
        f"/api/v1/focus/documents/{version_id}/annotations",
        {
            "expected_collection_revision": 0,
            "idempotency_key": str(uuid4()),
            "annotations": [_stroke(annotation_id)],
            "deleted_ids": [],
        },
        format="json",
    )
    deleted = client.post(
        f"/api/v1/focus/documents/{version_id}/annotations",
        {
            "expected_collection_revision": created.json()["collection_revision"],
            "idempotency_key": str(uuid4()),
            "annotations": [],
            "deleted_ids": [annotation_id],
        },
        format="json",
    )
    restored = client.post(
        f"/api/v1/focus/documents/{version_id}/annotations",
        {
            "expected_collection_revision": deleted.json()["collection_revision"],
            "idempotency_key": str(uuid4()),
            "annotations": [_stroke(annotation_id)],
            "deleted_ids": [],
        },
        format="json",
    )

    assert created.status_code == 200
    assert deleted.status_code == 200
    assert restored.status_code == 200
    assert restored.json()["annotations"][0]["id"] == annotation_id
    assert FocusAnnotation.objects.get(id=annotation_id).deleted_at is None


def test_session_actions_use_server_timeline_and_reject_client_duration() -> None:
    _, student, _, version_id = _workspace_fixture()
    client = _client(student)
    session_id = _start(client, version_id).json()["id"]
    session = FocusSession.objects.get(id=session_id)
    earlier = timezone.now() - timedelta(seconds=90)
    session.started_at = earlier
    session.save(update_fields=("started_at",))
    FocusSessionActivity.objects.filter(
        session=session,
        activity_type=FocusSessionActivity.ActivityType.STARTED,
    ).update(occurred_at=earlier)

    paused = client.post(f"/api/v1/focus/sessions/{session_id}/pause", {}, format="json")
    resumed = client.post(f"/api/v1/focus/sessions/{session_id}/resume", {}, format="json")
    rejected_duration = client.post(
        f"/api/v1/focus/sessions/{session_id}/complete",
        {"active_duration_seconds": 999999},
        format="json",
    )
    completed = client.post(f"/api/v1/focus/sessions/{session_id}/complete", {}, format="json")

    assert paused.json()["status"] == FocusSession.Status.PAUSED
    assert resumed.json()["status"] == FocusSession.Status.ACTIVE
    assert rejected_duration.status_code == 400
    assert completed.status_code == 200
    assert completed.json()["status"] == FocusSession.Status.COMPLETED
    assert 89 <= completed.json()["active_duration_seconds"] < 180
    assert list(
        FocusSessionActivity.objects.filter(session_id=session_id).values_list(
            "activity_type", flat=True
        )
    ) == ["started", "paused", "resumed", "completed"]


def test_session_history_is_paginated_and_owner_scoped() -> None:
    _, student, _, version_id = _workspace_fixture()
    _start(_client(student), version_id)
    other = create_user(email="history-other@example.com")
    _grant_focus(other)
    _start(_client(other), version_id)

    response = _client(student).get("/api/v1/focus/sessions?page_size=10")

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["results"][0]["workspace"]["document_version_id"] == version_id

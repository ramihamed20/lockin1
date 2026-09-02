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
from apps.focus.models import (
    FocusSession,
    FocusSessionActivity,
    FocusSessionNote,
    FocusSessionTask,
    FocusTeamMembership,
)

pytestmark = pytest.mark.django_db


def _grant(user: User) -> None:
    EntitlementGrant.objects.create(
        user=user,
        entitlement=EntitlementDefinition.objects.get(code="focus.workspace"),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
    )


def _fixture() -> tuple[User, str]:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    learning_object = published_pdf(actor=admin, node=lesson)
    student = create_user(email="lock-in-student@example.com")
    _grant(student)
    assert learning_object.published_version_id is not None
    return student, str(learning_object.published_version_id)


def _client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _start(client: APIClient, version_id: str, **extra: object):  # type: ignore[no-untyped-def]
    return client.post(
        "/api/v1/focus/lock-in",
        {
            "document_version_id": version_id,
            "client_instance_id": str(uuid4()),
            "session_type": "timed",
            "planned_duration_seconds": 1500,
            "break_duration_seconds": 300,
            "goal": "Review the chapter",
            **extra,
        },
        format="json",
    )


def test_lock_in_bootstrap_uses_real_materials_and_starts_a_persisted_session() -> None:
    student, version_id = _fixture()
    client = _client(student)

    bootstrap = client.get("/api/v1/focus/lock-in")
    started = _start(
        client,
        version_id,
        note="Work through the examples.",
        tasks=[{"client_task_id": str(uuid4()), "title": "Read section one"}],
    )

    assert bootstrap.status_code == 200
    assert bootstrap.json()["materials"][0]["document_version_id"] == version_id
    assert started.status_code == 201
    assert started.json()["session"]["status"] == FocusSession.Status.ACTIVE
    assert started.json()["material"]["document_version_id"] == version_id
    assert started.json()["note"]["body"] == "Work through the examples."
    assert started.json()["tasks"][0]["title"] == "Read section one"
    assert FocusSession.objects.filter(user=student).count() == 1


def test_lock_in_prevents_duplicate_active_sessions_and_recovers_the_existing_one() -> None:
    student, version_id = _fixture()
    client = _client(student)
    first = _start(client, version_id)
    replay = _start(client, version_id)
    resumed = client.get("/api/v1/focus/lock-in")

    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json()["session"]["id"] == first.json()["session"]["id"]
    assert resumed.json()["active_session"]["session"]["id"] == first.json()["session"]["id"]
    assert FocusSession.objects.filter(user=student).count() == 1


def test_lock_in_persists_a_trimmed_team_name_on_the_session() -> None:
    student, version_id = _fixture()
    client = _client(student)

    started = _start(client, version_id, team_name="  Oral Anatomy Squad  ")

    assert started.status_code == 201
    assert started.json()["session"]["team_name"] == "Oral Anatomy Squad"
    assert (
        FocusSession.objects.get(id=started.json()["session"]["id"]).team_name
        == "Oral Anatomy Squad"
    )


def test_lock_in_team_membership_message_and_session_are_persisted() -> None:
    owner, version_id = _fixture()
    owner_client = _client(owner)
    created = owner_client.post(
        "/api/v1/focus/lock-in/teams", {"name": "Oral Anatomy Squad"}, format="json"
    )

    assert created.status_code == 201
    team = created.json()["team"]
    assert team["name"] == "Oral Anatomy Squad"
    assert team["member_count"] == 1
    assert FocusTeamMembership.objects.filter(team_id=team["id"], user=owner).exists()

    message = owner_client.post(
        f"/api/v1/focus/lock-in/teams/{team['id']}/messages",
        {"body": "Ready to focus?"},
        format="json",
    )
    assert message.status_code == 201
    assert message.json()["messages"][0]["body"] == "Ready to focus?"

    member = create_user(email="lock-in-team-member@example.com")
    _grant(member)
    member_client = _client(member)
    joined = member_client.post(
        "/api/v1/focus/lock-in/teams/join",
        {"invite_code": team["invite_code"]},
        format="json",
    )
    assert joined.status_code == 200
    assert joined.json()["team"]["member_count"] == 2

    started = _start(owner_client, version_id, team_id=team["id"])
    assert started.status_code == 201
    assert started.json()["team"]["id"] == team["id"]
    assert started.json()["team"]["member_count"] == 2


def test_lock_in_pause_resume_and_break_are_server_state_transitions() -> None:
    student, version_id = _fixture()
    client = _client(student)
    session_id = _start(client, version_id).json()["session"]["id"]

    paused = client.post(f"/api/v1/focus/lock-in/{session_id}/pause", {}, format="json")
    resumed = client.post(f"/api/v1/focus/lock-in/{session_id}/resume", {}, format="json")
    on_break = client.post(f"/api/v1/focus/lock-in/{session_id}/start-break", {}, format="json")
    focus_again = client.post(f"/api/v1/focus/lock-in/{session_id}/end-break", {}, format="json")
    idempotent_resume = client.post(f"/api/v1/focus/lock-in/{session_id}/resume", {}, format="json")

    assert paused.json()["session"]["status"] == FocusSession.Status.PAUSED
    assert resumed.json()["session"]["status"] == FocusSession.Status.ACTIVE
    assert on_break.json()["session"]["status"] == FocusSession.Status.ON_BREAK
    assert focus_again.json()["session"]["status"] == FocusSession.Status.ACTIVE
    assert idempotent_resume.status_code == 200
    assert idempotent_resume.json()["session"]["status"] == FocusSession.Status.ACTIVE
    assert list(
        FocusSessionActivity.objects.filter(session_id=session_id).values_list(
            "activity_type", flat=True
        )
    ) == ["started", "paused", "resumed", "break_started", "break_ended"]


def test_lock_in_note_autosave_tasks_and_terminal_states_are_distinct() -> None:
    student, version_id = _fixture()
    client = _client(student)
    session_id = _start(client, version_id).json()["session"]["id"]
    saved = client.patch(
        f"/api/v1/focus/lock-in/{session_id}/note",
        {"body": "A durable note", "expected_revision": None},
        format="json",
    )
    task_id = uuid4()
    created_task = client.post(
        f"/api/v1/focus/lock-in/{session_id}/tasks",
        {"client_task_id": str(task_id), "title": "Answer two questions"},
        format="json",
    )
    task = created_task.json()["tasks"][0]
    toggled = client.post(
        f"/api/v1/focus/lock-in/{session_id}/tasks/{task['id']}/toggle", {}, format="json"
    )
    abandoned = client.post(f"/api/v1/focus/lock-in/{session_id}/abandon", {}, format="json")
    complete_after_abandon = client.post(
        f"/api/v1/focus/lock-in/{session_id}/complete", {}, format="json"
    )

    assert saved.status_code == 200
    assert FocusSessionNote.objects.get(session_id=session_id).body == "A durable note"
    assert created_task.status_code == 201
    assert toggled.json()["tasks"][0]["completed_at"] is not None
    assert abandoned.json()["session"]["status"] == FocusSession.Status.ABANDONED
    assert complete_after_abandon.status_code == 400
    assert FocusSessionTask.objects.filter(session_id=session_id).count() == 1


def test_lock_in_complete_uses_timeline_not_client_duration_and_returns_summary() -> None:
    student, version_id = _fixture()
    client = _client(student)
    session_id = _start(client, version_id).json()["session"]["id"]
    session = FocusSession.objects.get(id=session_id)
    started_at = timezone.now() - timedelta(seconds=75)
    session.started_at = started_at
    session.save(update_fields=("started_at",))
    FocusSessionActivity.objects.filter(session=session, activity_type="started").update(
        occurred_at=started_at
    )

    rejected = client.post(
        f"/api/v1/focus/lock-in/{session_id}/complete",
        {"active_duration_seconds": 999999},
        format="json",
    )
    completed = client.post(f"/api/v1/focus/lock-in/{session_id}/complete", {}, format="json")

    assert rejected.status_code == 400
    assert completed.status_code == 200
    assert completed.json()["session"]["status"] == FocusSession.Status.COMPLETED
    assert completed.json()["timing"]["active_elapsed_seconds"] >= 74
    assert completed.json()["daily_summary"]["completed_sessions"] == 1


def test_lock_in_enforces_the_server_entitlement() -> None:
    _, version_id = _fixture()
    client = _client(create_user(email="lock-in-no-access@example.com"))

    response = _start(client, version_id)

    assert response.status_code == 403
    assert not FocusSession.objects.filter(user__email="lock-in-no-access@example.com").exists()

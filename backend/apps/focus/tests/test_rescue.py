from datetime import timedelta
from uuid import uuid4

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.tests.test_catalog_workspace import catalog_fixture, client_for, grant_focus
from apps.focus.models import ActiveStudyRun, FocusSession
from apps.focus.rescue_models import RescueMutationReceipt, RescueSession
from apps.progress.models import LearningProgress
from apps.xp.models import XpTransaction

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def configuration(tmp_path):
    with override_settings(
        MEDIA_ROOT=str(tmp_path), START_RESCUE_ENABLED=True, COHORT_CONTENT_ENFORCEMENT=True
    ):
        yield


@pytest.fixture
def fixture():
    document, own, other = catalog_fixture()
    document.managed_file.pdf_page_count = 10
    document.managed_file.save(update_fields=["pdf_page_count"])
    user = create_user(email="rescue@example.com", cohort=own)
    second = create_user(email="rescue-second@example.com", cohort=own)
    outsider = create_user(email="rescue-outsider@example.com", cohort=other)
    for student in [user, second, outsider]:
        grant_focus(student)
    return document, user, second, outsider


def body(document, user, **changes):
    return {
        "account_id": str(user.id),
        "device_mutation_id": str(uuid4()),
        "expected_revision": 0,
        "catalog_document_id": str(document.id),
        "learning_object_version_id": str(document.version_id),
        "managed_file_id": str(document.managed_file_id),
        "edition": document.edition,
        "task_type": "read",
        "page_start": 1,
        "page_end": 1,
        "started_at": None,
        "ended_at": None,
        "active_duration_seconds": 0,
        "status": "proposed",
        "exit_reason": "",
        "continued_into_study_session_id": None,
        **changes,
    }


def url(identifier):
    return f"/api/v1/focus/rescue/sessions/{identifier}"


def test_flags_auth_and_source_permissions(fixture):
    document, user, _, outsider = fixture
    query = f"/api/v1/focus/rescue/suggestions?document_id={document.id}&page=1"
    assert APIClient().get(query).status_code in {401, 403}
    assert client_for(outsider).get(query).status_code == 403
    with override_settings(START_RESCUE_ENABLED=False):
        assert client_for(user).get(query).status_code == 403
    activity = client_for(user).get(query).json()["activities"][0]
    assert activity["managed_file_id"] == str(document.managed_file_id)
    assert activity["learning_object_version_id"] == str(document.version_id)
    assert activity["path"].endswith("/anatomy/sheets/cranial-nerves/workspace")
    assert client_for(user).get(query.replace("page=1", "page=11")).status_code == 403


def test_saving_replay_and_continuation_do_not_create_learning_or_xp(fixture):
    document, user, second, _ = fixture
    identifier = uuid4()
    payload = body(document, user)
    client = client_for(user)
    progress, xp = LearningProgress.objects.count(), XpTransaction.objects.count()
    first = client.put(url(identifier), payload, format="json")
    assert first.status_code == 200
    assert client.put(url(identifier), payload, format="json").json() == first.json()
    assert RescueSession.objects.count() == 1
    assert RescueMutationReceipt.objects.count() == 1
    assert (
        client_for(second).put(url(identifier), body(document, second), format="json").status_code
        == 404
    )
    now = timezone.now()
    final = body(
        document,
        user,
        expected_revision=1,
        status="continued",
        started_at=(now - timedelta(seconds=2)).isoformat(),
        ended_at=now.isoformat(),
        active_duration_seconds=2,
        exit_reason="continue",
    )
    result = client.put(url(identifier), final, format="json")
    assert result.status_code == 200
    assert result.json()["continued_into_study_session_id"] is None
    assert LearningProgress.objects.count() == progress
    assert XpTransaction.objects.count() == xp
    assert FocusSession.objects.count() == 0
    assert client.put(url(identifier), final, format="json").json() == result.json()


def test_revisions_mutation_reuse_and_source_replacement_are_fenced(fixture):
    document, user, _, _ = fixture
    identifier = uuid4()
    payload = body(document, user)
    client = client_for(user)
    assert client.put(url(identifier), payload, format="json").status_code == 200
    assert (
        client.put(
            url(identifier), {**payload, "page_start": 2, "page_end": 2}, format="json"
        ).status_code
        == 409
    )
    assert client.put(url(identifier), body(document, user), format="json").status_code == 409
    assert (
        client.put(
            url(uuid4()),
            body(document, user, learning_object_version_id=str(uuid4())),
            format="json",
        ).status_code
        == 409
    )
    assert (
        client.put(
            url(uuid4()), body(document, user, account_id=str(uuid4())), format="json"
        ).status_code
        == 403
    )


def test_student_can_stop_immediately_and_finish_only_after_recording_target(fixture):
    document, user, _, _ = fixture
    client = client_for(user)
    now = timezone.now()
    immediate = body(
        document, user, status="stopped", ended_at=now.isoformat(), exit_reason="user_stop"
    )
    assert client.put(url(uuid4()), immediate, format="json").status_code == 200
    bad_finish = body(
        document,
        user,
        status="finished",
        started_at=(now - timedelta(seconds=5)).isoformat(),
        ended_at=now.isoformat(),
        active_duration_seconds=5,
        exit_reason="enough_today",
    )
    assert client.put(url(uuid4()), bad_finish, format="json").status_code == 400
    valid = {
        **bad_finish,
        "started_at": (now - timedelta(seconds=180)).isoformat(),
        "active_duration_seconds": 180,
    }
    assert client.put(url(uuid4()), valid, format="json").status_code == 200


def test_locked_active_study_pages_and_duplicate_starts_are_denied(fixture):
    document, user, _, _ = fixture
    ActiveStudyRun.objects.create(
        user=user,
        sheet=document.version.learning_object,
        page_count=10,
        difficulty="medium",
        edition=document.edition,
        status="active",
        current_part=1,
        plan_signature={
            "page_ranges": [
                {"part": 1, "start_page": 1, "end_page": 3},
                {"part": 2, "start_page": 4, "end_page": 10},
            ]
        },
    )
    client = client_for(user)
    query = f"/api/v1/focus/rescue/suggestions?document_id={document.id}&page=4"
    assert client.get(query).status_code == 403
    assert (
        client.put(
            url(uuid4()), body(document, user, page_start=4, page_end=4), format="json"
        ).status_code
        == 403
    )
    started = timezone.now().isoformat()
    assert (
        client.put(
            url(uuid4()), body(document, user, status="active", started_at=started), format="json"
        ).status_code
        == 200
    )
    assert (
        client.put(
            url(uuid4()), body(document, user, status="active", started_at=started), format="json"
        ).status_code
        == 409
    )


def test_existing_timer_and_revoked_document(fixture):
    document, user, _, _ = fixture
    FocusSession.objects.create(user=user, status="active")
    started = timezone.now().isoformat()
    client = client_for(user)
    assert (
        client.put(
            url(uuid4()), body(document, user, status="active", started_at=started), format="json"
        ).status_code
        == 409
    )
    document.is_active = False
    document.save(update_fields=["is_active"])
    query = f"/api/v1/focus/rescue/suggestions?document_id={document.id}"
    assert client.get(query).status_code == 404


def test_ended_history_survives_document_revision_without_remapping(fixture):
    document, user, _, _ = fixture
    client = client_for(user)
    identifier = uuid4()
    started = timezone.now() - timedelta(seconds=10)
    initial = body(document, user, status="active", started_at=started.isoformat())
    assert client.put(url(identifier), initial, format="json").status_code == 200
    document.is_active = False
    document.save(update_fields=["is_active"])
    ended = body(
        document,
        user,
        status="stopped",
        started_at=started.isoformat(),
        ended_at=timezone.now().isoformat(),
        active_duration_seconds=10,
        exit_reason="source_changed",
        expected_revision=1,
    )
    assert client.put(url(identifier), ended, format="json").status_code == 200
    assert RescueSession.objects.get(pk=identifier).managed_file_id == document.managed_file_id

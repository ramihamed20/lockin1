from datetime import timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.deletion_processing import begin_deletion, erase_personal_data
from apps.accounts.models import User
from apps.accounts.services import confirm_account_deletion, request_account_deletion
from apps.accounts.tests.helpers import create_user
from apps.content.models import LearningObject
from apps.entitlements.services import entitlement_decision
from apps.focus.models import FocusSession, FocusSessionNote
from apps.subscriptions.models import SubscriptionAccount

pytestmark = pytest.mark.django_db


def _request(user):
    request, token = request_account_deletion(user=user)
    confirm_account_deletion(raw_token=token.raw_token)
    request.refresh_from_db()
    return request


def _work(user, text="My private study note"):
    session = FocusSession.objects.create(user=user)
    return FocusSessionNote.objects.create(session=session, body=text)


def _begin(request, admin):
    return begin_deletion(
        request_id=request.id,
        actor=admin,
        retention_reason=(
            "Retain only specific financial and security dispute evidence "
            "reviewed for this request."
        ),
        retained_until=timezone.now() + timedelta(days=365),
    )


def test_export_is_owner_scoped_and_excludes_credentials():
    owner = create_user(email="export-owner@example.com")
    other = create_user(email="export-other@example.com")
    _work(owner, "Owner private work")
    _work(other, "Other private work")
    client = APIClient()
    client.force_authenticate(owner)
    response = client.get("/api/v1/account/data-export")
    assert response.status_code == 200
    body = str(response.json())
    assert "Owner private work" in body
    assert "Other private work" not in body
    assert owner.password not in body
    assert "token_digest" not in body


def test_expired_subscription_keeps_work_and_data_export_access():
    user = create_user(email="expired-rights@example.com", with_trial=True)
    note = _work(user)
    sub = user.subscription_accounts.get().subscriptions.get()
    sub.status = "expired"
    sub.save(update_fields=("status",))
    assert not entitlement_decision(user=user, entitlement_code="focus.workspace").allowed
    assert FocusSessionNote.objects.filter(id=note.id).exists()
    client = APIClient()
    client.force_authenticate(user)
    assert client.get("/api/v1/account/data-export").status_code == 200


def test_confirming_deletion_is_not_completion_and_requires_retention_approval():
    user = create_user(email="gate-rights@example.com")
    note = _work(user)
    request = _request(user)
    admin = create_user(email="gate-admin@example.com", is_superuser=True)
    assert request.completed_at is None
    with pytest.raises(ValueError, match="retention matrix"):
        _begin(request, admin)
    assert FocusSessionNote.objects.filter(id=note.id).exists()


def test_reviewed_erasure_removes_private_work_and_identity_but_preserves_financial_reference(
    settings,
):
    settings.ACCOUNT_DELETION_POLICY_VERSION = "approved-test-matrix"
    user = create_user(email="erase-owner@example.com", with_trial=True)
    other = create_user(email="erase-other@example.com")
    own = _work(user)
    theirs = _work(other)
    request = _request(user)
    admin = create_user(email="erase-admin@example.com", is_superuser=True)
    _begin(request, admin)
    completed = erase_personal_data(request_id=request.id, actor=admin)
    user.refresh_from_db()
    assert completed.status == "completed"
    assert not FocusSessionNote.objects.filter(id=own.id).exists()
    assert FocusSessionNote.objects.filter(id=theirs.id).exists()
    assert user.status == User.Status.DELETED
    assert not user.is_active and not user.has_usable_password()
    assert user.full_name == "" and user.username is None
    assert user.email.endswith("@deleted.invalid")
    assert SubscriptionAccount.objects.filter(primary_user=user).exists()
    assert (
        erase_personal_data(request_id=request.id, actor=admin).completed_at
        == completed.completed_at
    )


def test_creator_material_blocks_erasure_until_separately_reviewed(settings):
    settings.ACCOUNT_DELETION_POLICY_VERSION = "approved-test-matrix"
    user = create_user(email="creator-rights@example.com")
    LearningObject.objects.create(owner=user)
    request = _request(user)
    admin = create_user(email="creator-admin@example.com", is_superuser=True)
    with pytest.raises(ValueError, match="shared or published"):
        _begin(request, admin)
    user.refresh_from_db()
    assert user.status == "active"


def test_signed_journal_replays_erasure_after_backup_restore(settings, tmp_path):
    settings.ACCOUNT_DELETION_POLICY_VERSION = "approved-test-matrix"
    user = create_user(email="restore-rights@example.com")
    request = _request(user)
    admin = create_user(email="restore-admin@example.com", is_superuser=True)
    _begin(request, admin)
    erase_personal_data(request_id=request.id, actor=admin)
    output = StringIO()
    call_command("account_deletion_manifest", stdout=output)
    path = tmp_path / "deletions.signed"
    path.write_text(output.getvalue())
    # Simulate a restored identity and an older saved note.
    User.objects.filter(id=user.id).update(
        email="restored@example.com", full_name="Restored identity", status="active", is_active=True
    )
    note = _work(user, "Resurrected backup note")
    call_command(
        "account_deletion_manifest",
        replay=str(path),
        apply=True,
        actor=str(admin.id),
        stdout=StringIO(),
    )
    assert not FocusSessionNote.objects.filter(id=note.id).exists()
    user.refresh_from_db()
    assert user.status == "deleted"


def test_tampered_restore_journal_is_rejected(tmp_path):
    path = tmp_path / "bad.signed"
    path.write_text("forged-deletion-list")
    with pytest.raises(CommandError):
        call_command("account_deletion_manifest", replay=str(path), stdout=StringIO())


def test_shared_cascade_cannot_erase_another_students_participation(settings):
    from apps.focus.models import FocusSessionParticipant

    settings.ACCOUNT_DELETION_POLICY_VERSION = "approved-test-matrix"
    user = create_user(email="shared-owner@example.com")
    other = create_user(email="shared-participant@example.com")
    note = _work(user)
    participation = FocusSessionParticipant.objects.create(session=note.session, user=other)
    request = _request(user)
    admin = create_user(email="shared-admin@example.com", is_superuser=True)
    _begin(request, admin)
    with pytest.raises(ValueError, match="shared data"):
        erase_personal_data(request_id=request.id, actor=admin)
    assert FocusSessionParticipant.objects.filter(id=participation.id).exists()
    assert FocusSessionNote.objects.filter(id=note.id).exists()
    request.refresh_from_db()
    assert request.status == "processing"


def test_personal_export_never_discloses_an_active_assessment_answer_key():
    from django.contrib.auth.models import Group

    from apps.accounts.roles import MANAGED_ROLES
    from apps.assessments.attempt_services import start_attempt
    from apps.assessments.tests.test_attempts import _assessment_fixture

    for role in MANAGED_ROLES:
        Group.objects.get_or_create(name=role.value)
    _, student, _, _, quiz = _assessment_fixture()
    from uuid import uuid4

    attempt = start_attempt(user=student, quiz_id=quiz.id, idempotency_key=uuid4()).attempt
    assert attempt.questions.first().correct_option_ids
    client = APIClient()
    client.force_authenticate(student)
    response = client.get("/api/v1/account/data-export")
    assert response.status_code == 200
    question = response.json()["study_data"]["assessments.AttemptQuestion"][0]
    assert "correct_option_ids" not in question
    assert "explanation" not in question
    assert "option_snapshot" not in question

from datetime import timedelta
from typing import Any

import pytest
from django.contrib.auth.models import Group

from apps.accounts.events import UserRegistered, UserRolesChanged
from apps.accounts.models import AccountSecurityEvent, OneTimeToken
from apps.accounts.roles import Role, RoleChangeError, replace_managed_roles
from apps.accounts.services import (
    AccountStateError,
    AccountTokenError,
    issue_token,
    register_user,
    request_email_change,
    verify_email,
)
from apps.education.models import StudentCohort
from platform_core.events import DomainEvent, domain_events

from .helpers import PASSWORD, create_user

pytestmark = pytest.mark.django_db


def test_registration_event_is_published_only_after_commit(
    django_capture_on_commit_callbacks: Any,
) -> None:
    received: list[UserRegistered] = []

    def receive_registration(event: DomainEvent) -> None:
        assert isinstance(event, UserRegistered)
        received.append(event)

    unsubscribe = domain_events.subscribe(UserRegistered, receive_registration)
    try:
        with django_capture_on_commit_callbacks(execute=False) as callbacks:
            user, _ = register_user(
                email="event@example.com",
                full_name="Event Student",
                password=PASSWORD,
                preferred_language="en",
                cohort=StudentCohort.objects.get(code="61"),
            )
            assert received == []
        assert len(callbacks) == 1
        callbacks[0]()
    finally:
        unsubscribe()

    assert [event.user_id for event in received] == [user.id]
    assert AccountSecurityEvent.objects.filter(
        user=user, event_type=AccountSecurityEvent.EventType.REGISTERED
    ).exists()


def test_expired_verification_token_is_rejected() -> None:
    user = create_user(verified=False)
    token = issue_token(
        user=user,
        kind=OneTimeToken.Kind.EMAIL_VERIFICATION,
        lifetime=timedelta(seconds=-1),
    )

    with pytest.raises(AccountTokenError):
        verify_email(raw_token=token.raw_token)

    user.refresh_from_db()
    assert not user.is_email_verified


def test_issuing_new_token_revokes_previous_token() -> None:
    user = create_user(verified=False)
    first = issue_token(
        user=user,
        kind=OneTimeToken.Kind.EMAIL_VERIFICATION,
        lifetime=timedelta(hours=1),
    )
    second = issue_token(
        user=user,
        kind=OneTimeToken.Kind.EMAIL_VERIFICATION,
        lifetime=timedelta(hours=1),
    )

    with pytest.raises(AccountTokenError):
        verify_email(raw_token=first.raw_token)
    assert verify_email(raw_token=second.raw_token) == user


def test_email_change_rejects_an_address_owned_by_another_user() -> None:
    user = create_user()
    create_user(email="owned@example.com")

    with pytest.raises(AccountStateError):
        request_email_change(user=user, new_email="OWNED@example.com")


def test_role_changes_emit_after_commit_and_write_authoritative_record(
    django_capture_on_commit_callbacks: Any,
) -> None:
    admin = create_user(email="admin@example.com")
    target = create_user()
    Group.objects.get(name=Role.ADMINISTRATOR.value).user_set.add(admin)
    received: list[UserRolesChanged] = []

    def receive_role_change(event: DomainEvent) -> None:
        assert isinstance(event, UserRolesChanged)
        received.append(event)

    unsubscribe = domain_events.subscribe(UserRolesChanged, receive_role_change)
    try:
        with django_capture_on_commit_callbacks(execute=True):
            roles = replace_managed_roles(
                target=target,
                actor=admin,
                roles={Role.MODERATOR, Role.CREATOR},
            )
    finally:
        unsubscribe()

    assert roles == ("student", "moderator", "creator")
    assert received[0].roles == roles
    event = AccountSecurityEvent.objects.get(
        user=target, event_type=AccountSecurityEvent.EventType.ROLE_CHANGED
    )
    assert event.actor == admin
    assert event.metadata == {"roles": list(roles)}


def test_role_service_rejects_student_as_an_assignable_group() -> None:
    admin = create_user(email="admin@example.com")
    target = create_user()

    with pytest.raises(RoleChangeError):
        replace_managed_roles(target=target, actor=admin, roles={Role.STUDENT})

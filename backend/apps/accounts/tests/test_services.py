from datetime import timedelta
from typing import Any

import pytest
from django.contrib.auth.models import Group

from apps.accounts.events import UserRegistered, UserRolesChanged
from apps.accounts.models import AccountSecurityEvent, OneTimeToken
from apps.accounts.roles import Role, RoleChangeError, replace_managed_roles
from apps.accounts.services import (
    VERIFICATION_CODE_ATTEMPT_LIMIT,
    AccountStateError,
    AccountTokenError,
    issue_token,
    issue_verification_code,
    register_user,
    request_email_change,
    verify_email_code,
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


def test_expired_verification_code_is_rejected() -> None:
    user = create_user(verified=False)
    token = issue_token(
        user=user,
        kind=OneTimeToken.Kind.EMAIL_VERIFICATION,
        lifetime=timedelta(seconds=-1),
        value="123456",
        scope=str(user.id),
    )

    with pytest.raises(AccountTokenError):
        verify_email_code(user=user, code=token.raw_token)

    user.refresh_from_db()
    assert not user.is_email_verified


def test_issuing_a_new_code_revokes_the_previous_one() -> None:
    user = create_user(verified=False)
    first = issue_verification_code(user=user)
    second = issue_verification_code(user=user)

    with pytest.raises(AccountTokenError):
        verify_email_code(user=user, code=first.raw_token)
    assert verify_email_code(user=user, code=second.raw_token) == user


def test_a_code_is_six_digits_and_belongs_to_one_account_only() -> None:
    """Six digits collide across accounts; the stored hash must not.

    `OneTimeToken.token_digest` is unique, so hashing the code alone would make
    two accounts holding "123456" impossible -- and would let either one's code
    verify the other. The digest is taken over the account and the code
    together, which is also the only lookup that makes sense for a value this
    short.
    """

    first = create_user(email="code-one@example.com", verified=False)
    second = create_user(email="code-two@example.com", verified=False)
    issue_token(
        user=first,
        kind=OneTimeToken.Kind.EMAIL_VERIFICATION,
        lifetime=timedelta(minutes=10),
        value="123456",
        scope=str(first.id),
    )
    issue_token(
        user=second,
        kind=OneTimeToken.Kind.EMAIL_VERIFICATION,
        lifetime=timedelta(minutes=10),
        value="123456",
        scope=str(second.id),
    )

    third = create_user(email="code-three@example.com", verified=False)
    issued = issue_verification_code(user=third)
    assert len(issued.raw_token) == 6
    assert issued.raw_token.isdigit()
    # Each account's code verifies that account, and only that account.
    assert verify_email_code(user=first, code="123456") == first
    assert verify_email_code(user=second, code="123456") == second


def test_a_code_survives_only_a_bounded_number_of_wrong_guesses() -> None:
    user = create_user(verified=False)
    issued = issue_verification_code(user=user)

    wrong = "000000" if issued.raw_token != "000000" else "111111"
    for _ in range(VERIFICATION_CODE_ATTEMPT_LIMIT):
        with pytest.raises(AccountTokenError):
            verify_email_code(user=user, code=wrong)

    # The code is spent even though it was never guessed: a new one is required.
    with pytest.raises(AccountTokenError):
        verify_email_code(user=user, code=issued.raw_token)
    user.refresh_from_db()
    assert not user.is_email_verified


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

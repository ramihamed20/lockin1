from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from datetime import timedelta
from threading import Barrier, BrokenBarrierError, Event

import pytest
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.sessions.models import Session
from django.db import close_old_connections, connection
from django.http import HttpRequest
from django.utils import timezone

from apps.accounts.models import AccountEmailDelivery, AccountSession, OneTimeToken
from apps.accounts.services import (
    establish_account_session,
    invalidate_sessions,
    issue_verification_code,
    verification_code_resend_wait,
)
from apps.accounts.tests.helpers import create_user, csrf_client


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_parallel_verification_resends_enqueue_one_message() -> None:
    user = create_user(email="resend-race@example.test", verified=False)
    after_cooldown_read = Barrier(2)

    def resend(_: int):
        close_old_connections()

        def pause(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if (
                sql.startswith("SELECT")
                and '"accounts_onetimetoken"."created_at"' in sql
                and "LIMIT 1" in sql
            ):
                with suppress(BrokenBarrierError):
                    after_cooldown_read.wait(timeout=1)
            return result

        try:
            client, csrf = csrf_client()
            with connection.execute_wrapper(pause):
                response = client.post(
                    "/api/v1/auth/resend-verification",
                    {"email": user.email},
                    format="json",
                    HTTP_X_CSRFTOKEN=csrf,
                )
            return response.status_code, response.json()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(resend, range(2)))
    assert responses == [(200, {"status": "accepted", "retry_after_seconds": 60})] * 2
    assert OneTimeToken.objects.filter(user=user).count() == 1
    assert AccountEmailDelivery.objects.filter(token__user=user).count() == 1


@pytest.mark.django_db
def test_verification_cooldown_rounds_up_remaining_fractional_seconds(monkeypatch) -> None:
    user = create_user(email="resend-boundary@example.test", verified=False)
    issue_verification_code(user=user)
    token = OneTimeToken.objects.get(user=user)
    now = timezone.now()
    OneTimeToken.objects.filter(pk=token.pk).update(created_at=now - timedelta(seconds=59.5))
    monkeypatch.setattr("apps.accounts.services.timezone.now", lambda: now)
    assert verification_code_resend_wait(user=user) == 1


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_session_invalidation_cannot_leave_a_concurrent_login_untracked() -> None:
    user = create_user(email="session-race@example.test")

    def login():
        close_old_connections()
        try:
            request = HttpRequest()
            request.session = SessionStore()
            establish_account_session(request=request, user=user, remember_me=False)
            return request.session.session_key
        finally:
            close_old_connections()

    original = login()
    keys_read = Event()
    finish_invalidation = Event()

    def invalidate():
        close_old_connections()

        def pause(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if sql.startswith("SELECT") and '"accounts_accountsession"."session_key"' in sql:
                keys_read.set()
                assert finish_invalidation.wait(timeout=10)
            return result

        try:
            with connection.execute_wrapper(pause):
                return invalidate_sessions(user=user)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        invalidating = pool.submit(invalidate)
        assert keys_read.wait(timeout=10)
        signing_in = pool.submit(login)
        try:
            with suppress(TimeoutError):
                signing_in.result(timeout=1)
        finally:
            finish_invalidation.set()
        invalidating.result(timeout=10)
        new_key = signing_in.result(timeout=10)
    assert not Session.objects.filter(session_key=original).exists()
    assert Session.objects.filter(session_key=new_key).exists()
    assert AccountSession.objects.filter(user=user, session_key=new_key).exists()


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@pytest.mark.parametrize("flow", ["password_reset", "email_change", "account_deletion"])
def test_parallel_sensitive_confirmation_spends_a_link_only_once(flow) -> None:
    from apps.accounts import services

    user = create_user(email=f"confirm-{flow}@example.test")
    if flow == "password_reset":
        _, issued = services.request_password_reset(email=user.email)
    elif flow == "email_change":
        issued = services.request_email_change(user=user, new_email="new-confirm@example.test")
    else:
        _, issued = services.request_account_deletion(user=user)
    start = Barrier(2)

    def confirm():
        if flow == "password_reset":
            return services.confirm_password_reset(
                raw_token=issued.raw_token, new_password="Synthetic-reset-2026!"
            )
        if flow == "email_change":
            return services.confirm_email_change(raw_token=issued.raw_token)
        return services.confirm_account_deletion(raw_token=issued.raw_token)

    def attempt(_: int):
        close_old_connections()
        try:
            start.wait(timeout=10)
            confirm()
            return "confirmed"
        except services.AccountTokenError:
            return "spent"
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt, range(2))) == ["confirmed", "spent"]


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_cancelling_deletion_serializes_with_confirmation() -> None:
    from apps.accounts import services

    user = create_user(email="delete-cancel-race@example.test")
    deletion, issued = services.request_account_deletion(user=user)
    start = Barrier(2)

    def change(action):
        close_old_connections()
        try:
            start.wait(timeout=10)
            if action == "cancel":
                services.cancel_account_deletion(user=user)
            else:
                with suppress(services.AccountTokenError):
                    services.confirm_account_deletion(raw_token=issued.raw_token)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(change, ["cancel", "confirm"]))
    deletion.refresh_from_db()
    assert deletion.status == "cancelled"
    assert not OneTimeToken.objects.get(user=user).is_usable

"""Security boundaries reproduced with synthetic accounts and local requests."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from datetime import timedelta
from threading import Barrier, BrokenBarrierError, Event
from unittest.mock import patch

import pytest
from django.contrib.sessions.backends.db import SessionStore
from django.db import close_old_connections
from django.http import HttpRequest
from django.utils import timezone

from apps.accounts import services
from apps.accounts.models import AccountSession, OAuthFlow, SocialIdentity, User
from apps.accounts.oauth import OAuthAccountLinkError, ProviderProfile, resolve_social_user
from apps.accounts.tests.helpers import PASSWORD, create_user, csrf_client


@pytest.mark.django_db
def test_email_change_revokes_old_mailbox_recovery_links_and_all_devices() -> None:
    user = create_user()
    devices = []
    for _ in range(2):
        client, csrf = csrf_client()
        assert (
            client.post(
                "/api/v1/auth/login",
                {"email": user.email, "password": PASSWORD},
                format="json",
                HTTP_X_CSRFTOKEN=csrf,
            ).status_code
            == 200
        )
        devices.append(client)
    result = services.request_password_reset(email=user.email)
    assert result is not None
    _, recovery = result
    email_token = services.request_email_change(user=user, new_email="new-mailbox@example.test")
    services.confirm_email_change(raw_token=email_token.raw_token)

    with pytest.raises(services.AccountTokenError):
        services.confirm_password_reset(raw_token=recovery.raw_token, new_password=PASSWORD)
    assert not AccountSession.objects.filter(user=user).exists()
    assert all(client.get("/api/v1/auth/session").status_code == 403 for client in devices)


@pytest.mark.django_db
@pytest.mark.parametrize("mutation", ["password", "status", "email"])
def test_session_creation_rejects_identity_changed_after_authentication(mutation: str) -> None:
    stale = create_user()
    fresh = User.objects.get(pk=stale.pk)
    if mutation == "password":
        fresh.set_password("Changed-in-another-request-2026!")
        fresh.save(update_fields=["password"])
    elif mutation == "status":
        User.objects.filter(pk=fresh.pk).update(status=User.Status.SUSPENDED, is_active=False)
    else:
        User.objects.filter(pk=fresh.pk).update(email="changed@example.test")
    request = HttpRequest()
    request.session = SessionStore()
    with pytest.raises(services.AccountStateError):
        services.establish_account_session(request=request, user=stale, remember_me=False)
    assert not AccountSession.objects.filter(user=stale).exists()


@pytest.mark.django_db
def test_password_change_cannot_overwrite_a_concurrent_password_reset() -> None:
    stale = create_user()
    result = services.request_password_reset(email=stale.email)
    assert result is not None
    services.confirm_password_reset(
        raw_token=result[1].raw_token, new_password="Recovered-in-another-request-2026!"
    )
    with pytest.raises(services.AccountStateError):
        services.change_password(user=stale, new_password=PASSWORD, keep_session_key=None)
    stale.refresh_from_db()
    assert stale.check_password("Recovered-in-another-request-2026!")


@pytest.mark.django_db
def test_google_cannot_link_an_existing_account_using_only_third_party_email_verified() -> None:
    user = create_user(email="owner@external.example")
    flow = OAuthFlow.objects.create(
        provider="google",
        intent="login",
        expires_at=timezone.now() + timedelta(minutes=10),
    )
    profile = ProviderProfile(
        provider="google",
        subject="old-google-owner",
        email=user.email,
        email_verified=True,
        full_name="Synthetic",
        is_private_relay=False,
    )
    with pytest.raises(OAuthAccountLinkError):
        resolve_social_user(profile=profile, flow=flow)
    assert not SocialIdentity.objects.filter(user=user).exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "endpoint,scope",
    [
        ("login", "login"),
        ("password-reset", "password_reset_request"),
    ],
)
def test_rotating_sources_does_not_bypass_identifier_limit(settings, endpoint, scope) -> None:
    settings.ACCOUNT_LOGIN_ACCOUNT_ATTEMPT_LIMIT = 2
    settings.ACCOUNT_SENSITIVE_REQUEST_LIMIT = 2
    client, csrf = csrf_client()
    payload = {"email": "synthetic@example.test"}
    if scope == "login":
        payload["password"] = "incorrect"
    responses = [
        client.post(
            f"/api/v1/auth/{endpoint}",
            payload,
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
            REMOTE_ADDR=f"198.51.100.{index + 1}",
        ).status_code
        for index in range(3)
    ]
    assert responses[:2] == ([403, 403] if scope == "login" else [200, 200])
    assert responses[2] == 429


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_parallel_failed_logins_cannot_both_take_the_last_rate_limit_slot(settings) -> None:
    settings.ACCOUNT_LOGIN_ATTEMPT_LIMIT = 1
    inside_authentication = Barrier(2)

    def deny(*args, **kwargs):
        with suppress(BrokenBarrierError):
            inside_authentication.wait(timeout=1)
        return None

    def attempt(_):
        close_old_connections()
        try:
            client, csrf = csrf_client()
            return client.post(
                "/api/v1/auth/login",
                {"email": "synthetic@example.test", "password": "wrong"},
                format="json",
                HTTP_X_CSRFTOKEN=csrf,
            ).status_code
        finally:
            close_old_connections()

    with (
        patch("apps.accounts.views.authenticate", side_effect=deny),
        ThreadPoolExecutor(max_workers=2) as pool,
    ):
        assert sorted(pool.map(attempt, range(2))) == [403, 429]


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_password_change_rotation_cannot_resurrect_a_session_after_logout_all() -> None:
    from django.contrib.auth import update_session_auth_hash

    user = create_user()
    client, csrf = csrf_client()
    assert (
        client.post(
            "/api/v1/auth/login",
            {"email": user.email, "password": PASSWORD},
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        ).status_code
        == 200
    )
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    rotating = Event()
    finish_rotation = Event()

    def pause_rotation(request, account):
        rotating.set()
        assert finish_rotation.wait(timeout=10)
        update_session_auth_hash(request, account)

    def change():
        close_old_connections()
        try:
            return client.post(
                "/api/v1/account/password",
                {
                    "current_password": PASSWORD,
                    "new_password": "Changed-with-a-race-2026!",
                    "new_password_confirm": "Changed-with-a-race-2026!",
                },
                format="json",
                HTTP_X_CSRFTOKEN=csrf,
            ).status_code
        finally:
            close_old_connections()

    def revoke():
        close_old_connections()
        try:
            services.invalidate_sessions(user=user)
        finally:
            close_old_connections()

    with (
        patch("apps.accounts.views.update_session_auth_hash", side_effect=pause_rotation),
        ThreadPoolExecutor(max_workers=2) as pool,
    ):
        changing = pool.submit(change)
        assert rotating.wait(timeout=10)
        revoking = pool.submit(revoke)
        try:
            with suppress(TimeoutError):
                revoking.result(timeout=1)
        finally:
            finish_rotation.set()
        assert changing.result(timeout=10) in (200, 400)
        revoking.result(timeout=10)
    assert client.get("/api/v1/auth/session").status_code == 403
    assert not AccountSession.objects.filter(user=user).exists()


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_reset_issuance_cannot_survive_a_concurrent_email_identity_change() -> None:
    from django.db import connection

    user = create_user()
    email_token = services.request_email_change(user=user, new_email="new-identity@example.test")
    snapshot_read = Event()
    continue_request = Event()

    def request_reset():
        close_old_connections()
        paused = False

        def pause(execute, sql, params, many, context):
            nonlocal paused
            result = execute(sql, params, many, context)
            if not paused and sql.startswith("SELECT") and '"accounts_user"."email"' in sql:
                paused = True
                snapshot_read.set()
                assert continue_request.wait(timeout=10)
            return result

        try:
            with connection.execute_wrapper(pause):
                return services.request_password_reset(email=user.email)
        finally:
            close_old_connections()

    def confirm_email():
        close_old_connections()
        try:
            return services.confirm_email_change(raw_token=email_token.raw_token)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        requesting = pool.submit(request_reset)
        assert snapshot_read.wait(timeout=10)
        confirming = pool.submit(confirm_email)
        try:
            with suppress(TimeoutError):
                confirming.result(timeout=1)
        finally:
            continue_request.set()
        result = requesting.result(timeout=10)
        confirming.result(timeout=10)
    if result is not None:
        with pytest.raises(services.AccountTokenError):
            services.confirm_password_reset(raw_token=result[1].raw_token, new_password=PASSWORD)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "email,domain", [("owner@gmail.com", ""), ("owner@workspace.example", "workspace.example")]
)
def test_google_authoritative_email_can_link_an_existing_account(email, domain) -> None:
    user = create_user(email=email)
    flow = OAuthFlow.objects.create(
        provider="google", intent="login", expires_at=timezone.now() + timedelta(minutes=10)
    )
    profile = ProviderProfile(
        provider="google",
        subject="authoritative-owner",
        email=email,
        email_verified=True,
        full_name="Synthetic",
        is_private_relay=False,
        hosted_domain=domain,
    )
    resolved = resolve_social_user(profile=profile, flow=flow)
    assert resolved.pk == user.pk
    assert SocialIdentity.objects.filter(user=user, subject=profile.subject).exists()


@pytest.mark.django_db
@pytest.mark.parametrize("domain", ["", "different.example"])
def test_google_external_email_cannot_create_a_new_account_without_mailbox_authority(
    domain,
) -> None:
    flow = OAuthFlow.objects.create(
        provider="google", intent="signup", expires_at=timezone.now() + timedelta(minutes=10)
    )
    profile = ProviderProfile(
        provider="google",
        subject="external-subject",
        email="new@external.example",
        email_verified=True,
        full_name="Synthetic",
        is_private_relay=False,
        hosted_domain=domain,
    )
    with pytest.raises(OAuthAccountLinkError):
        resolve_social_user(profile=profile, flow=flow)
    assert not User.objects.filter(email=profile.email).exists()


@pytest.mark.django_db
def test_google_existing_subject_does_not_depend_on_later_email_authority() -> None:
    user = create_user(email="owner@external.example")
    SocialIdentity.objects.create(
        user=user, provider="google", subject="known-subject", provider_email=user.email
    )
    flow = OAuthFlow.objects.create(
        provider="google", intent="login", expires_at=timezone.now() + timedelta(minutes=10)
    )
    profile = ProviderProfile(
        provider="google",
        subject="known-subject",
        email=user.email,
        email_verified=True,
        full_name="Synthetic",
        is_private_relay=False,
    )
    assert resolve_social_user(profile=profile, flow=flow).pk == user.pk

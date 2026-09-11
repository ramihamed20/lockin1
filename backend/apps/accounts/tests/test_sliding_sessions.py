"""Sessions slide on activity and stop at an absolute ceiling.

The old behaviour was a fixed window from sign-in: a reader studying for a long
evening was signed out mid-sheet, and the only escape offered was "remember me"
for thirty days -- a worse trade on a shared device.

Now two clocks run. The idle window is pushed forward by authenticated activity;
the absolute window is measured from sign-in and cannot be pushed at all.
"""

import time
from typing import Any

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.middleware import (
    SESSION_REMEMBER,
    SESSION_SLID_AT,
    SESSION_STARTED_AT,
    session_windows,
)
from apps.accounts.models import AccountSession

from .helpers import PASSWORD, create_user, csrf_client

pytestmark = pytest.mark.django_db


def _sign_in(*, remember: bool = False, email: str = "slider@example.com"):
    user = create_user(email=email)
    client, csrf = csrf_client()
    response = client.post(
        "/api/v1/auth/login",
        {"email": user.email, "password": PASSWORD, "remember_me": remember},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert response.status_code == 200
    return user, client


def test_sign_in_stamps_the_absolute_clock_and_the_remember_choice() -> None:
    _, client = _sign_in(remember=True)

    session = client.session
    assert isinstance(session[SESSION_STARTED_AT], float)
    assert session[SESSION_REMEMBER] is True


def test_activity_pushes_the_idle_window_forward() -> None:
    _, client = _sign_in()
    session = client.session
    # Pretend the last slide was long enough ago to be eligible again, and that
    # the session is most of the way through its idle window.
    session[SESSION_SLID_AT] = time.time() - 3_600
    session.set_expiry(60)
    session.save()
    before = client.session.get_expiry_age()

    assert client.get("/api/v1/auth/session").status_code == 200

    after = client.session.get_expiry_age()
    idle_seconds, _ = session_windows(remember=False)
    assert before <= 60
    assert after > before
    assert after == pytest.approx(idle_seconds, abs=5)


def test_a_burst_of_requests_costs_one_session_write() -> None:
    """The throttle is what keeps sliding off the hot path."""

    _, client = _sign_in(email="burst@example.com")
    first = client.session[SESSION_SLID_AT]

    for _ in range(5):
        assert client.get("/api/v1/auth/session").status_code == 200

    # Inside the slide interval, so the stamp is untouched.
    assert client.session[SESSION_SLID_AT] == first


def test_the_absolute_ceiling_ends_the_session_however_active_it_is(settings: Any) -> None:
    settings.ACCOUNT_SESSION_ABSOLUTE_AGE_SECONDS = 60
    _, client = _sign_in(email="ceiling@example.com")
    session = client.session
    # Signed in more than the ceiling ago, but continuously active since.
    session[SESSION_STARTED_AT] = time.time() - 120
    session[SESSION_SLID_AT] = time.time()
    session.save()

    response = client.get("/api/v1/auth/session")

    assert response.status_code in {401, 403}
    assert not client.session.items()


def test_sliding_never_extends_past_the_ceiling(settings: Any) -> None:
    settings.ACCOUNT_SESSION_ABSOLUTE_AGE_SECONDS = 3_600
    _, client = _sign_in(email="clamped@example.com")
    session = client.session
    # Fifty minutes in: ten minutes of ceiling left, far less than the 12-hour
    # idle window, so the idle window must be clamped down to it.
    session[SESSION_STARTED_AT] = time.time() - 3_000
    session[SESSION_SLID_AT] = time.time() - 3_000
    session.save()

    assert client.get("/api/v1/auth/session").status_code == 200

    remaining = client.session.get_expiry_age()
    assert 0 < remaining <= 600 + 5


def test_the_session_list_follows_the_slide(settings: Any) -> None:
    """The reader-visible device list must not expire before the session does."""

    settings.ACCOUNT_SESSION_SLIDE_INTERVAL_SECONDS = 0
    _, client = _sign_in(email="devicelist@example.com")
    key = client.session.session_key
    AccountSession.objects.filter(session_key=key).update(
        expires_at=timezone.now() + timezone.timedelta(seconds=30)
    )

    assert client.get("/api/v1/auth/session").status_code == 200

    refreshed = AccountSession.objects.get(session_key=key)
    assert refreshed.expires_at > timezone.now() + timezone.timedelta(hours=1)


def test_anonymous_traffic_never_creates_or_writes_a_session() -> None:
    from django.contrib.sessions.models import Session

    before = Session.objects.count()
    anonymous = APIClient()

    anonymous.get("/api/v1/auth/session")
    anonymous.get("/api/v1/health/live")

    assert Session.objects.count() == before


def test_remember_me_uses_the_longer_pair_of_windows() -> None:
    ordinary_idle, ordinary_absolute = session_windows(remember=False)
    remembered_idle, remembered_absolute = session_windows(remember=True)

    assert remembered_idle > ordinary_idle
    assert remembered_absolute > ordinary_absolute
    # An absolute ceiling that is not longer than the idle window would make the
    # idle window unreachable and the sliding pointless.
    assert ordinary_absolute > ordinary_idle
    assert remembered_absolute > remembered_idle


def test_logout_still_ends_the_session_immediately() -> None:
    _, client = _sign_in(email="logout-slide@example.com")
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]

    assert client.post("/api/v1/auth/logout", HTTP_X_CSRFTOKEN=csrf).status_code == 204

    assert client.get("/api/v1/auth/session").status_code in {401, 403}


def test_suspension_still_invalidates_a_sliding_session() -> None:
    from apps.accounts.models import User
    from apps.accounts.services import set_account_status

    user, client = _sign_in(email="suspended-slide@example.com")
    admin = create_user(email="suspend-admin@example.com", is_superuser=True, is_staff=True)

    set_account_status(
        target=user,
        actor=admin,
        status=User.Status.SUSPENDED,
        reason="Suspended during an active sliding session.",
    )

    assert client.get("/api/v1/auth/session").status_code in {401, 403}


def test_a_session_created_before_this_existed_is_adopted_not_expired() -> None:
    """A deploy must not sign everyone out."""

    _, client = _sign_in(email="legacy-session@example.com")
    session = client.session
    del session[SESSION_STARTED_AT]
    del session[SESSION_SLID_AT]
    session.save()

    assert client.get("/api/v1/auth/session").status_code == 200
    assert isinstance(client.session[SESSION_STARTED_AT], float)

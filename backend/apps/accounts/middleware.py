"""Sliding authenticated sessions with a hard ceiling.

The session used to be a fixed window from sign-in: twelve hours, or thirty days
with "remember me", regardless of what the reader was doing. Someone studying
for a long evening was signed out mid-sheet, and the only workaround offered was
the thirty-day option, which is a worse trade for a shared device.

Two clocks replace it:

* **Idle** — the session survives this long after the last authenticated
  request, and every authenticated request pushes it forward.
* **Absolute** — measured from sign-in and never extended. It is the answer to
  "how long can a stolen cookie possibly be useful", and sliding cannot outrun
  it.

Both are shorter than the single window they replace, so this tightens the
security position while removing the interruption.
"""

import time
from collections.abc import Callable
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.http import HttpRequest, HttpResponse
from django.utils import timezone

SESSION_STARTED_AT = "lockin_session_started_at"
SESSION_SLID_AT = "lockin_session_slid_at"
SESSION_REMEMBER = "lockin_session_remember"


def _setting(name: str, default: int) -> int:
    return int(getattr(settings, name, default))


def session_windows(*, remember: bool) -> tuple[int, int]:
    """Return ``(idle_seconds, absolute_seconds)`` for this kind of session."""

    if remember:
        return (
            _setting("ACCOUNT_REMEMBER_SESSION_AGE_SECONDS", 2_592_000),
            _setting("ACCOUNT_REMEMBER_SESSION_ABSOLUTE_AGE_SECONDS", 7_776_000),
        )
    return (
        _setting("ACCOUNT_SESSION_AGE_SECONDS", 43_200),
        _setting("ACCOUNT_SESSION_ABSOLUTE_AGE_SECONDS", 604_800),
    )


class SlidingSessionMiddleware:
    """Extend an active session, up to its absolute deadline.

    Deliberately narrow about when it writes:

    * anonymous requests are ignored entirely, so unauthenticated traffic never
      touches the session table;
    * an authenticated request extends the session at most once per
      ``ACCOUNT_SESSION_SLIDE_INTERVAL_SECONDS``, so a burst of API calls costs
      one write rather than one per request.

    Static assets never reach Django in production -- nginx serves them -- so no
    path filtering is needed here.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        self._slide(request)
        return self.get_response(request)

    def _slide(self, request: HttpRequest) -> None:
        user = getattr(request, "user", None)
        session = getattr(request, "session", None)
        if session is None or user is None or not user.is_authenticated:
            return

        now = time.time()
        remember = bool(session.get(SESSION_REMEMBER, False))
        idle_seconds, absolute_seconds = session_windows(remember=remember)

        started_at = session.get(SESSION_STARTED_AT)
        if not isinstance(started_at, int | float):
            # A session created before this middleware existed. Adopt it from
            # now rather than expiring it, so a deploy does not sign everyone
            # out; its absolute deadline starts here.
            started_at = now
            session[SESSION_STARTED_AT] = started_at

        remaining_absolute = (started_at + absolute_seconds) - now
        if remaining_absolute <= 0:
            # The ceiling is reached. Flushing alone is not enough: this request
            # already has an authenticated ``request.user`` resolved by
            # AuthenticationMiddleware, so it would be served normally and only
            # the *next* one refused. Replace the user as well, so the request
            # that crossed the ceiling is the first one denied.
            session.flush()
            request.user = AnonymousUser()
            return

        # Never past the ceiling, however active the reader is.
        next_expiry = int(min(idle_seconds, remaining_absolute))
        slid_at = session.get(SESSION_SLID_AT)
        interval = _setting("ACCOUNT_SESSION_SLIDE_INTERVAL_SECONDS", 300)
        if isinstance(slid_at, int | float) and now - slid_at < interval:
            return

        session[SESSION_SLID_AT] = now
        session.set_expiry(next_expiry)
        self._touch_account_session(request=request, expires_in=next_expiry)

    @staticmethod
    def _touch_account_session(*, request: HttpRequest, expires_in: int) -> None:
        """Keep the reader-visible session list and the cleanup job in step.

        Without this the ``AccountSession`` row would still carry the original
        expiry, so the retention job would delete the record of a session that
        is still alive and the reader's device list would lose it.
        """

        session_key = request.session.session_key
        if not session_key:
            return
        from .models import AccountSession

        AccountSession.objects.filter(session_key=session_key).update(
            last_seen_at=timezone.now(),
            expires_at=timezone.now() + timedelta(seconds=expires_in),
        )

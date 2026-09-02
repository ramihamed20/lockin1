"""Test helpers for the streamed private-file delivery path."""

from django.core.signals import request_finished
from django.db import close_old_connections
from django.http.response import HttpResponseBase


def close_streamed(response: HttpResponseBase) -> None:
    """Close a streamed response without dropping the test's database connection.

    Django's test client disconnects ``close_old_connections`` around an
    ordinary response's ``close()``, but not around a streamed one: the stream
    is closed by the caller, long after the handler restored that receiver
    (``django/test/client.py``, the ``streaming_content`` branch). So the
    caller's ``close()`` fires ``request_finished`` with the receiver live.

    Inside a test's atomic block that is destructive. ``close_old_connections``
    reaches ``close_if_unusable_or_obsolete()``, which sees ``get_autocommit()``
    return False while the settings say True, concludes the connection is
    unusable, and closes it. Because the close happens in an atomic block,
    Django keeps the closed connection object rather than clearing it, so every
    later query in the test fails with "the connection is closed".

    SQLite never showed this: its backend ignores ``close()`` for an in-memory
    database, which is what the SQLite test path uses. PostgreSQL does not, so
    this only appears in the authoritative CI run.
    """

    request_finished.disconnect(close_old_connections)
    try:
        response.close()
    finally:
        request_finished.connect(close_old_connections)

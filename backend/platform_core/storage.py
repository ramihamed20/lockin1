"""Storage-neutral reads for private managed files.

Managed files are delivered by the API rather than by a public bucket URL, so
every read still passes the entitlement and malware-scan checks. That makes the
read path performance-sensitive: the S3 file object bundled with
``django-storages`` downloads a whole object into a temporary file before the
first byte can be read, which would pull an entire 50 MB PDF into the
container's tmpfs on every view.

``open_managed_object`` keeps the byte-range contract instead. Object storage
gets a ranged GET; a filesystem deployment seeks. Both providers stream, and
neither behaviour is written into the calling view.
"""

import contextlib
from collections.abc import Iterator
from typing import Any

from django.db.models.fields.files import FieldFile

DEFAULT_CHUNK_SIZE = 64 * 1024


def _provider_error_types() -> tuple[type[BaseException], ...]:
    try:
        from botocore.exceptions import BotoCoreError, ClientError
    except ImportError:  # pragma: no cover - the S3 extra is a pinned dependency
        return ()
    return (ClientError, BotoCoreError)


# Every provider failure means the same thing to the caller: the object is not
# readable, and the request must answer as if it does not exist.
UNREADABLE_OBJECT_ERRORS: tuple[type[BaseException], ...] = (OSError, *_provider_error_types())


class ManagedObjectUnavailable(Exception):
    """The stored object could not be opened for reading."""


class ManagedObject:
    """An open handle that can stream any byte range from the stored object."""

    def __init__(self, handle: Any, remote: Any | None) -> None:
        self._handle = handle
        self._remote = remote

    def stream(
        self,
        *,
        start: int = 0,
        length: int | None = None,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ) -> Iterator[bytes]:
        if self._remote is not None:
            return self._stream_remote(
                self._remote, start=start, length=length, chunk_size=chunk_size
            )
        return self._stream_local(start=start, length=length, chunk_size=chunk_size)

    def _stream_remote(
        self, remote: Any, *, start: int, length: int | None, chunk_size: int
    ) -> Iterator[bytes]:
        # An open-ended range keeps the request valid when only the offset is known.
        byte_range = f"bytes={start}-" if length is None else f"bytes={start}-{start + length - 1}"
        try:
            body = remote.get(Range=byte_range)["Body"]
            try:
                while True:
                    chunk = body.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk
            finally:
                body.close()
        finally:
            self.close()

    def _stream_local(self, *, start: int, length: int | None, chunk_size: int) -> Iterator[bytes]:
        remaining = length
        try:
            if start:
                self._handle.seek(start)
            while remaining is None or remaining > 0:
                size = chunk_size if remaining is None else min(chunk_size, remaining)
                chunk = self._handle.read(size)
                if not chunk:
                    break
                if remaining is not None:
                    remaining -= len(chunk)
                yield chunk
        finally:
            self.close()

    def reader(self, *, chunk_size: int = DEFAULT_CHUNK_SIZE) -> "SequentialReader":
        """Expose the object as a forward-only reader for consumers such as the scanner."""

        return SequentialReader(self.stream(chunk_size=chunk_size))

    def close(self) -> None:
        # Closing a handle that is already gone is not actionable here.
        with contextlib.suppress(OSError):
            self._handle.close()


def open_managed_object(field_file: FieldFile) -> ManagedObject:
    """Open a stored object, raising :class:`ManagedObjectUnavailable` when it is missing."""

    if not field_file.name:
        raise ManagedObjectUnavailable("The managed file has no stored object.")
    try:
        handle = field_file.storage.open(field_file.name, "rb")
    except UNREADABLE_OBJECT_ERRORS as error:
        raise ManagedObjectUnavailable(str(error)) from error
    # django-storages exposes the boto3 object as a documented attribute; its
    # absence simply means a filesystem-backed deployment.
    return ManagedObject(handle, getattr(handle, "obj", None))


class SequentialReader:
    """Adapt a chunk iterator to the forward-only ``read(size)`` contract.

    The malware scanner and other byte consumers only ever read forward, so this
    avoids staging a whole object in memory or in the container filesystem.
    """

    def __init__(self, chunks: Iterator[bytes]) -> None:
        self._chunks = chunks
        self._buffer = bytearray()
        self._exhausted = False

    def readable(self) -> bool:
        return True

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            self._buffer.extend(b"".join(self._chunks))
            self._exhausted = True
            payload = bytes(self._buffer)
            self._buffer.clear()
            return payload
        while len(self._buffer) < size and not self._exhausted:
            chunk = next(self._chunks, b"")
            if not chunk:
                self._exhausted = True
                break
            self._buffer.extend(chunk)
        payload = bytes(self._buffer[:size])
        del self._buffer[:size]
        return payload

    def close(self) -> None:
        self._chunks.close()  # type: ignore[attr-defined]

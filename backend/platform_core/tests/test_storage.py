"""Managed files must stream from any provider without staging a whole object."""

from io import BytesIO
from typing import Any

import pytest

from platform_core.storage import (
    ManagedObject,
    ManagedObjectUnavailable,
    SequentialReader,
    open_managed_object,
)

PAYLOAD = b"".join(bytes([value % 251]) for value in range(4096))


class _FakeBody:
    def __init__(self, payload: bytes) -> None:
        self._stream = BytesIO(payload)
        self.closed = False

    def read(self, size: int = -1) -> bytes:
        return self._stream.read(size)

    def close(self) -> None:
        self.closed = True


class _FakeRemoteObject:
    """The subset of the boto3 object API the delivery path relies on."""

    def __init__(self, payload: bytes) -> None:
        self._payload = payload
        self.requested_ranges: list[str] = []
        self.bodies: list[_FakeBody] = []

    def get(self, *, Range: str) -> dict[str, Any]:  # noqa: N803 - boto3 spells it this way
        self.requested_ranges.append(Range)
        prefix, _, span = Range.partition("=")
        assert prefix == "bytes"
        start_text, _, end_text = span.partition("-")
        start = int(start_text)
        end = int(end_text) + 1 if end_text else len(self._payload)
        payload = self._payload[start:end]
        body = _FakeBody(payload)
        self.bodies.append(body)
        return {"Body": body}


class _FakeHandle:
    def __init__(self, payload: bytes, remote: _FakeRemoteObject | None = None) -> None:
        self._stream = BytesIO(payload)
        self.closed = False
        if remote is not None:
            self.obj = remote

    def read(self, size: int = -1) -> bytes:
        return self._stream.read(size)

    def seek(self, offset: int) -> int:
        return self._stream.seek(offset)

    def close(self) -> None:
        self.closed = True


class _FakeStorage:
    def __init__(self, handle: Any = None, error: Exception | None = None) -> None:
        self._handle = handle
        self._error = error
        self.opened: list[str] = []

    def open(self, name: str, mode: str) -> Any:
        self.opened.append(name)
        if self._error is not None:
            raise self._error
        return self._handle


class _FakeFieldFile:
    def __init__(self, name: str, storage: _FakeStorage) -> None:
        self.name = name
        self.storage = storage


def test_object_storage_reads_only_the_requested_range() -> None:
    remote = _FakeRemoteObject(PAYLOAD)
    handle = _FakeHandle(PAYLOAD, remote)
    stored = ManagedObject(handle, remote)

    body = b"".join(stored.stream(start=100, length=50, chunk_size=16))

    assert body == PAYLOAD[100:150]
    # A ranged GET is the whole point: without it the provider file object would
    # download all 4096 bytes before returning the first one.
    assert remote.requested_ranges == ["bytes=100-149"]
    assert remote.bodies[0].closed
    assert handle.closed


def test_object_storage_streams_the_whole_object_with_an_open_ended_range() -> None:
    remote = _FakeRemoteObject(PAYLOAD)
    stored = ManagedObject(_FakeHandle(PAYLOAD, remote), remote)

    assert b"".join(stored.stream(chunk_size=512)) == PAYLOAD
    assert remote.requested_ranges == ["bytes=0-"]


def test_filesystem_storage_seeks_to_the_requested_offset() -> None:
    handle = _FakeHandle(PAYLOAD)
    stored = ManagedObject(handle, None)

    assert b"".join(stored.stream(start=4000, length=96, chunk_size=32)) == PAYLOAD[4000:]
    assert handle.closed


def test_filesystem_streaming_stops_at_the_requested_length() -> None:
    stored = ManagedObject(_FakeHandle(PAYLOAD), None)

    assert b"".join(stored.stream(start=0, length=10, chunk_size=64)) == PAYLOAD[:10]


def test_a_length_beyond_the_object_returns_what_exists() -> None:
    stored = ManagedObject(_FakeHandle(PAYLOAD[:32]), None)

    assert b"".join(stored.stream(start=0, length=1024, chunk_size=8)) == PAYLOAD[:32]


def test_opening_a_row_without_a_stored_object_fails_closed() -> None:
    field_file = _FakeFieldFile("", _FakeStorage(_FakeHandle(PAYLOAD)))

    with pytest.raises(ManagedObjectUnavailable):
        open_managed_object(field_file)  # type: ignore[arg-type]


def test_an_unreadable_object_raises_the_shared_error() -> None:
    field_file = _FakeFieldFile("managed/pdf/a.pdf", _FakeStorage(error=OSError("gone")))

    with pytest.raises(ManagedObjectUnavailable, match="gone"):
        open_managed_object(field_file)  # type: ignore[arg-type]


def test_open_detects_a_provider_object_for_ranged_reads() -> None:
    remote = _FakeRemoteObject(PAYLOAD)
    storage = _FakeStorage(_FakeHandle(PAYLOAD, remote))
    field_file = _FakeFieldFile("managed/pdf/a.pdf", storage)

    stored = open_managed_object(field_file)  # type: ignore[arg-type]

    assert b"".join(stored.stream(start=8, length=8)) == PAYLOAD[8:16]
    assert storage.opened == ["managed/pdf/a.pdf"]


def test_sequential_reader_serves_exact_sizes_across_chunk_boundaries() -> None:
    reader = SequentialReader(iter([b"abcde", b"fghij", b"klmno"]))

    assert reader.readable()
    assert reader.read(3) == b"abc"
    assert reader.read(4) == b"defg"
    assert reader.read(100) == b"hijklmno"
    assert reader.read(1) == b""


def test_sequential_reader_drains_everything_on_an_unbounded_read() -> None:
    reader = SequentialReader(iter([b"one", b"two", b"three"]))

    assert reader.read(2) == b"on"
    assert reader.read(-1) == b"etwothree"
    assert reader.read(-1) == b""


def test_reader_streams_the_object_for_byte_consumers() -> None:
    remote = _FakeRemoteObject(PAYLOAD)
    stored = ManagedObject(_FakeHandle(PAYLOAD, remote), remote)

    reader = stored.reader(chunk_size=256)
    collected = bytearray()
    while chunk := reader.read(300):
        collected.extend(chunk)

    assert bytes(collected) == PAYLOAD
    assert remote.requested_ranges == ["bytes=0-"]

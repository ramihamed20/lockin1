"""A sheet delivered once is read from a verified local copy by every later reader."""

import hashlib
import os
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest

from platform_core import object_cache
from platform_core.storage import open_managed_object

PAYLOAD = b"".join(bytes([value % 251]) for value in range(200_000))
CHECKSUM = hashlib.sha256(PAYLOAD).hexdigest()
NAME = "managed/pdf/3f1c.pdf"


class _Body:
    def __init__(self, payload: bytes) -> None:
        self._stream = BytesIO(payload)

    def read(self, size: int = -1) -> bytes:
        return self._stream.read(size)

    def close(self) -> None:
        pass


class _Remote:
    def __init__(self, payload: bytes, log: list[str]) -> None:
        self._payload = payload
        self._log = log

    def get(self, *, Range: str) -> dict[str, Any]:  # noqa: N803 - boto3 spelling
        self._log.append(Range)
        start_text, _, end_text = Range.partition("=")[2].partition("-")
        end = int(end_text) + 1 if end_text else len(self._payload)
        return {"Body": _Body(self._payload[int(start_text) : end])}


class _Handle:
    def __init__(self, remote: _Remote) -> None:
        self.obj = remote

    def close(self) -> None:
        pass


class _Storage:
    """Provider-backed storage that records every request it is asked for."""

    def __init__(self, payload: bytes = PAYLOAD) -> None:
        self.payload = payload
        self.calls: list[str] = []
        self.ranges: list[str] = []

    def size(self, name: str) -> int:
        self.calls.append(f"size:{name}")
        return len(self.payload)

    def open(self, name: str, mode: str) -> _Handle:
        self.calls.append(f"open:{name}")
        return _Handle(_Remote(self.payload, self.ranges))


class _FieldFile:
    def __init__(self, storage: _Storage, checksum: str = CHECKSUM) -> None:
        self.name = NAME
        self.storage = storage
        self.instance = type("Row", (), {"checksum_sha256": checksum})()


def _fill(storage: _Storage, name: str = NAME) -> bool:
    return object_cache.fill(storage=storage, name=name, size=len(PAYLOAD), checksum=CHECKSUM)


@pytest.fixture
def cache_dir(tmp_path: Path, settings: Any) -> Path:
    settings.MANAGED_OBJECT_CACHE_DIR = str(tmp_path / "object-cache")
    settings.MANAGED_OBJECT_CACHE_MAX_BYTES = 10 * 1024 * 1024
    return tmp_path / "object-cache"


@pytest.fixture
def scheduled(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Capture background fills so a test decides when (and whether) they run."""

    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(object_cache, "schedule_fill", lambda **kwargs: calls.append(kwargs))
    return calls


def test_a_first_read_streams_from_the_provider_and_schedules_one_copy(
    cache_dir: Path, scheduled: list[dict[str, Any]]
) -> None:
    storage = _Storage()
    stored = open_managed_object(_FieldFile(storage), cache=True)  # type: ignore[arg-type]

    assert b"".join(stored.stream(start=10, length=20)) == PAYLOAD[10:30]
    assert stored.uses_ranged_reads
    assert [call["name"] for call in scheduled] == [NAME]
    assert scheduled[0]["checksum"] == CHECKSUM


def test_after_the_copy_every_reader_seeks_locally_without_the_provider(cache_dir: Path) -> None:
    assert _fill(_Storage())

    later = _Storage()
    stored = open_managed_object(_FieldFile(later), cache=True)  # type: ignore[arg-type]
    body = b"".join(stored.stream(start=150_000, length=1000))

    assert body == PAYLOAD[150_000:151_000]
    assert stored.size == len(PAYLOAD)
    assert not stored.uses_ranged_reads
    assert later.calls == []
    assert later.ranges == []


def test_a_copy_that_does_not_match_the_recorded_checksum_is_never_kept(cache_dir: Path) -> None:
    assert not _fill(_Storage(PAYLOAD[:-1] + b"\x00"))

    assert object_cache.open_cached(NAME) is None
    assert list(cache_dir.iterdir()) == []


def test_reads_without_the_cache_flag_never_use_or_start_a_copy(
    cache_dir: Path, scheduled: list[dict[str, Any]]
) -> None:
    _fill(_Storage())
    storage = _Storage()

    stored = open_managed_object(_FieldFile(storage), cache=False)  # type: ignore[arg-type]

    assert stored.uses_ranged_reads
    assert storage.calls
    assert scheduled == []


def test_the_cache_is_off_unless_configured(settings: Any, tmp_path: Path) -> None:
    settings.MANAGED_OBJECT_CACHE_DIR = str(tmp_path / "object-cache")
    settings.MANAGED_OBJECT_CACHE_MAX_BYTES = 0

    object_cache.schedule_fill(storage=_Storage(), name=NAME, size=len(PAYLOAD), checksum=CHECKSUM)

    assert object_cache.open_cached(NAME) is None
    assert not (tmp_path / "object-cache").exists()


def test_a_copy_already_in_progress_elsewhere_is_not_duplicated(cache_dir: Path) -> None:
    cache_dir.mkdir(parents=True)
    key = hashlib.sha256(NAME.encode()).hexdigest()
    (cache_dir / f"{key}{object_cache.PARTIAL_SUFFIX}").write_bytes(b"")
    storage = _Storage()

    assert not _fill(storage)
    assert storage.calls == []


def test_a_partial_left_by_a_dead_worker_is_taken_over(cache_dir: Path) -> None:
    cache_dir.mkdir(parents=True)
    key = hashlib.sha256(NAME.encode()).hexdigest()
    partial = cache_dir / f"{key}{object_cache.PARTIAL_SUFFIX}"
    partial.write_bytes(b"stale")
    old = time.time() - object_cache.STALE_PARTIAL_SECONDS - 5
    os.utime(partial, (old, old))

    assert _fill(_Storage())
    assert not partial.exists()


def test_the_least_recently_read_copies_are_evicted_to_stay_under_the_limit(
    cache_dir: Path, settings: Any
) -> None:
    settings.MANAGED_OBJECT_CACHE_MAX_BYTES = len(PAYLOAD) * 4
    names = [f"managed/pdf/{index}.pdf" for index in range(5)]
    for index, name in enumerate(names):
        assert _fill(_Storage(), name)
        stamp = time.time() - 1000 + index
        os.utime(cache_dir / hashlib.sha256(name.encode()).hexdigest(), (stamp, stamp))
    object_cache.evict()

    remaining = sum(entry.stat().st_size for entry in cache_dir.iterdir())
    assert remaining <= settings.MANAGED_OBJECT_CACHE_MAX_BYTES * 0.9
    assert object_cache.open_cached(names[0]) is None
    newest = object_cache.open_cached(names[-1])
    assert newest is not None
    newest[0].close()


def test_forgetting_a_file_removes_its_copy(cache_dir: Path) -> None:
    _fill(_Storage())

    object_cache.forget(NAME)

    assert object_cache.open_cached(NAME) is None


def test_schedule_fill_copies_in_the_background_once(cache_dir: Path) -> None:
    storage = _Storage()
    object_cache.schedule_fill(storage=storage, name=NAME, size=len(PAYLOAD), checksum=CHECKSUM)
    object_cache.schedule_fill(storage=storage, name=NAME, size=len(PAYLOAD), checksum=CHECKSUM)
    deadline = time.time() + 10
    while object_cache.open_cached(NAME) is None and time.time() < deadline:
        time.sleep(0.05)

    cached = object_cache.open_cached(NAME)
    assert cached is not None
    cached[0].close()
    assert storage.calls.count(f"open:{NAME}") == 1

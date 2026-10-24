"""A bounded local copy of private managed objects, shared by every reader.

pdf.js opens a sheet with a burst of byte-range requests and keeps asking for
ranges as the reader scrolls. Against object storage every one of those is a
size lookup plus a ranged GET from the application host, so a sheet costs the
same provider round trips for the hundredth student as for the first.

The first delivery of an object is still served straight from the provider,
and a full copy is written here in the background. Every later request --
from any account -- then seeks in a local file. The copy is only kept when its
SHA-256 matches the checksum recorded at upload, so it can never serve bytes
that differ from what was validated and scanned.

This is a byte source, not an access decision: the delivery view resolves the
file, the reader's access, the subscription and the scan state before it asks
for bytes, exactly as before. Object keys embed the file's id
(``managed/<kind>/<uuid>``) and are never rewritten, so a cached copy cannot go
stale; a deleted file's copy is removed with it, and the least recently read
copies are evicted to stay under ``MANAGED_OBJECT_CACHE_MAX_BYTES``.
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, BinaryIO

from django.conf import settings

logger = logging.getLogger(__name__)

FILL_CHUNK_SIZE = 1024 * 1024
# A fill that has not finished in this long belongs to a worker that died.
STALE_PARTIAL_SECONDS = 15 * 60
# Reads refresh a copy's age for eviction, but not more often than this.
TOUCH_INTERVAL_SECONDS = 60 * 60
PARTIAL_SUFFIX = ".partial"

_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()
_in_flight: set[str] = set()
_in_flight_lock = threading.Lock()
_unwritable = False


def max_bytes() -> int:
    return max(0, int(getattr(settings, "MANAGED_OBJECT_CACHE_MAX_BYTES", 0) or 0))


def enabled() -> bool:
    return max_bytes() > 0


def cache_directory() -> Path:
    return Path(settings.MANAGED_OBJECT_CACHE_DIR)


def _key(name: str) -> str:
    return hashlib.sha256(name.encode("utf-8")).hexdigest()


def _path(name: str) -> Path:
    return cache_directory() / _key(name)


def open_cached(name: str) -> tuple[BinaryIO, int] | None:
    """Return an open handle and size for a cached object, or None on a miss."""

    if not enabled():
        return None
    path = _path(name)
    try:
        handle = path.open("rb")
    except OSError:
        return None
    try:
        stat = os.fstat(handle.fileno())
        if time.time() - stat.st_mtime > TOUCH_INTERVAL_SECONDS:
            with contextlib.suppress(OSError):
                os.utime(path)
    except OSError:
        handle.close()
        return None
    return handle, stat.st_size


def schedule_fill(*, storage: Any, name: str, size: int, checksum: str) -> None:
    """Copy the object here in the background; at most one copy per object at a time."""

    if _unwritable or not enabled() or not checksum or size <= 0 or size > max_bytes() // 4:
        return
    if _path(name).exists():
        return
    with _in_flight_lock:
        if name in _in_flight:
            return
        _in_flight.add(name)
    try:
        _pool().submit(_fill_guarded, storage, name, size, checksum)
    except RuntimeError:
        # The worker is shutting down; the next request will try again.
        with _in_flight_lock:
            _in_flight.discard(name)


def forget(name: str) -> None:
    """Remove a cached copy, for example when its file is deleted."""

    if not name:
        return
    with contextlib.suppress(OSError):
        _path(name).unlink()


def _pool() -> ThreadPoolExecutor:
    # Created on first use, inside the serving process: a pool created before
    # Gunicorn forks would have no threads in the workers.
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="object-cache")
        return _executor


def _fill_guarded(storage: Any, name: str, size: int, checksum: str) -> None:
    try:
        fill(storage=storage, name=name, size=size, checksum=checksum)
    except Exception:  # noqa: BLE001 - a failed copy only means the next read is remote
        logger.warning("Managed object cache fill failed.", exc_info=True)
    finally:
        with _in_flight_lock:
            _in_flight.discard(name)


def fill(*, storage: Any, name: str, size: int, checksum: str) -> bool:
    """Copy one object into the cache. Returns True when a verified copy was stored."""

    # Imported here: storage.py imports this module.
    from platform_core.storage import ManagedObject

    global _unwritable
    directory = cache_directory()
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError:
        # A read-only or missing volume: say so once, then stop trying in
        # this process. Delivery carries on from the provider as before.
        if not _unwritable:
            logger.warning("Managed object cache directory is not writable; cache disabled.")
        _unwritable = True
        return False
    final = directory / _key(name)
    partial = final.with_name(final.name + PARTIAL_SUFFIX)
    if final.exists() or not _claim(partial):
        return False
    try:
        # A fresh handle on this thread: the request's own provider object is
        # still streaming to its client and is not shared across threads.
        handle = storage.open(name, "rb")
        source = ManagedObject(handle, getattr(handle, "obj", None), size=size)
        digest = hashlib.sha256()
        written = 0
        with partial.open("wb") as target:
            for chunk in source.stream(chunk_size=FILL_CHUNK_SIZE):
                digest.update(chunk)
                written += len(chunk)
                target.write(chunk)
        if written != size or digest.hexdigest() != checksum.lower():
            logger.warning("Managed object cache copy did not match its checksum; discarded.")
            return False
        os.replace(partial, final)
    finally:
        with contextlib.suppress(OSError):
            partial.unlink()
    evict()
    return True


def _claim(partial: Path) -> bool:
    """Create the partial file exclusively, so only one process copies an object."""

    for _ in range(2):
        try:
            descriptor = os.open(partial, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            try:
                if time.time() - partial.stat().st_mtime < STALE_PARTIAL_SECONDS:
                    return False
                partial.unlink()
            except OSError:
                return False
            continue
        os.close(descriptor)
        return True
    return False


def evict() -> None:
    """Delete the least recently read copies until the cache is under 90% of its limit."""

    limit = max_bytes()
    directory = cache_directory()
    entries: list[tuple[float, int, Path]] = []
    total = 0
    try:
        with os.scandir(directory) as iterator:
            for entry in iterator:
                if not entry.is_file() or entry.name.endswith(PARTIAL_SUFFIX):
                    continue
                stat = entry.stat()
                entries.append((stat.st_mtime, stat.st_size, Path(entry.path)))
                total += stat.st_size
    except OSError:
        return
    if total <= limit:
        return
    target = int(limit * 0.9)
    for _, entry_size, path in sorted(entries):
        if total <= target:
            break
        with contextlib.suppress(OSError):
            path.unlink()
            total -= entry_size

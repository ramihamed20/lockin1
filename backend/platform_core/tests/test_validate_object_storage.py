"""The staging gate a new storage provider has to pass before it carries files."""

import json
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from django.core.management import CommandError, call_command

MODULE = "platform_core.management.commands.validate_object_storage"


@pytest.fixture(autouse=True)
def small_probe() -> Any:
    # The real probe is 5 MiB so a ranged read is clearly not a whole download.
    # Tests only need the behaviour, not the volume.
    with (
        patch(f"{MODULE}.PROBE_BYTES", 8192),
        patch(f"{MODULE}.RANGE_START", 1024),
        patch(f"{MODULE}.RANGE_LENGTH", 512),
    ):
        yield


def _validate(*arguments: str) -> dict[str, Any]:
    stdout = StringIO()
    call_command("validate_object_storage", *arguments, stdout=stdout, stderr=StringIO())
    return dict(json.loads(stdout.getvalue().strip().splitlines()[-1]))


def test_a_filesystem_provider_round_trips_and_cleans_up(settings: Any, tmp_path: Path) -> None:
    settings.MEDIA_ROOT = tmp_path

    evidence = _validate()

    assert evidence["status"] == "ok"
    assert evidence["full_stream_checksum_matches"] is True
    assert evidence["ranged_read_matches"] is True
    assert evidence["partial_read_without_full_download"] is True
    assert evidence["deleted"] is True
    # A filesystem deployment seeks instead of issuing byte ranges, and reports it.
    assert evidence["ranged_reads"] is False
    assert not list(tmp_path.rglob("probe-*.bin"))


def test_keeping_the_probe_leaves_it_for_inspection(settings: Any, tmp_path: Path) -> None:
    settings.MEDIA_ROOT = tmp_path

    evidence = _validate("--keep", "--prefix", "manual-check")

    assert "deleted" not in evidence
    assert evidence["object"].startswith("manual-check/")
    assert list(tmp_path.rglob("probe-*.bin"))


class _FakeStorage:
    """A provider stub, used to drive the branches a real bucket would exercise."""

    def __init__(self, *, url: str, rename_to: str | None = None) -> None:
        self._objects: dict[str, bytes] = {}
        self._url = url
        self._rename_to = rename_to
        self.deleted: list[str] = []

    def save(self, name: str, content: Any) -> str:
        stored = self._rename_to or name
        self._objects[stored] = content.read()
        return stored

    def open(self, name: str, mode: str) -> BytesIO:
        return BytesIO(self._objects[name])

    def exists(self, name: str) -> bool:
        return name in self._objects

    def delete(self, name: str) -> None:
        self.deleted.append(name)
        self._objects.pop(name, None)

    def url(self, name: str) -> str:
        return self._url


def test_a_provider_that_renames_objects_is_rejected() -> None:
    storage = _FakeStorage(url="https://bucket.example.net/probe?X-Amz-Signature=abc")
    storage._rename_to = "renamed/probe.bin"

    with patch(f"{MODULE}.default_storage", storage), pytest.raises(CommandError, match="renamed"):
        _validate()

    # The stray object is removed rather than left behind.
    assert storage.deleted == ["renamed/probe.bin"]


def test_an_unsigned_object_url_is_rejected() -> None:
    # No query string means the bucket hands out durable public links.
    storage = _FakeStorage(url="https://bucket.example.net/probe.bin")

    with (
        patch(f"{MODULE}.default_storage", storage),
        pytest.raises(CommandError, match="STORAGE_QUERYSTRING_AUTH"),
    ):
        _validate()


def test_a_publicly_readable_object_is_rejected() -> None:
    storage = _FakeStorage(url="https://bucket.example.net/probe.bin?X-Amz-Signature=abc")

    class _Response:
        status = 200

        def __enter__(self) -> "_Response":
            return self

        def __exit__(self, *args: object) -> None:
            return None

    with (
        patch(f"{MODULE}.default_storage", storage),
        patch(f"{MODULE}.urlopen", return_value=_Response()),
        pytest.raises(CommandError, match="anonymously"),
    ):
        _validate()


def test_a_refused_anonymous_fetch_is_recorded_as_evidence() -> None:
    from urllib.error import HTTPError

    storage = _FakeStorage(url="https://bucket.example.net/probe.bin?X-Amz-Signature=abc")
    refusal = HTTPError("https://bucket.example.net/probe.bin", 403, "Forbidden", {}, None)  # type: ignore[arg-type]

    with (
        patch(f"{MODULE}.default_storage", storage),
        patch(f"{MODULE}.urlopen", side_effect=refusal),
    ):
        evidence = _validate()

    assert evidence["anonymous_access"] == "refused_403"
    assert evidence["status"] == "ok"


def test_the_anonymous_check_can_be_skipped_where_egress_is_blocked() -> None:
    storage = _FakeStorage(url="https://bucket.example.net/probe.bin?X-Amz-Signature=abc")

    with patch(f"{MODULE}.default_storage", storage):
        evidence = _validate("--skip-anonymous-check")

    assert evidence["anonymous_access"] == "skipped"

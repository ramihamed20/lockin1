"""Moving existing private media to object storage must be safe to re-run."""

import json
from io import StringIO
from pathlib import Path
from typing import Any

import pytest
from django.core.management import CommandError, call_command

from apps.education.tests.helpers import create_admin, pdf_upload

from ..models import ManagedFile
from ..services import create_managed_file

pytestmark = pytest.mark.django_db


@pytest.fixture
def media_roots(tmp_path: Path, settings: Any) -> tuple[Path, Path]:
    source = tmp_path / "source-media"
    destination = tmp_path / "destination-media"
    source.mkdir()
    destination.mkdir()
    settings.MEDIA_ROOT = source
    return source, destination


def _migrate(source: Path, *arguments: str) -> dict[str, Any]:
    stdout = StringIO()
    call_command(
        "migrate_managed_files",
        "--media-root",
        str(source),
        "--allow-filesystem-destination",
        *arguments,
        stdout=stdout,
        stderr=StringIO(),
    )
    return dict(json.loads(stdout.getvalue().strip().splitlines()[-1]))


def _stored_files(settings: Any, source: Path, destination: Path) -> list[ManagedFile]:
    admin = create_admin()
    files = [create_managed_file(owner=admin, upload=pdf_upload(), kind="pdf") for _ in range(3)]
    # Point the default storage at the destination so the command copies across.
    settings.MEDIA_ROOT = destination
    return files


def test_migration_copies_every_object_under_its_recorded_name(
    media_roots: tuple[Path, Path], settings: Any
) -> None:
    source, destination = media_roots
    files = _stored_files(settings, source, destination)

    evidence = _migrate(source, "--verify-checksum")

    assert evidence["copied"] == 3
    assert evidence["verified"] == 3
    assert evidence["mismatched"] == []
    for managed_file in files:
        copied = destination / managed_file.blob.name
        # The name is unchanged, so no database migration and no broken rows.
        assert copied.is_file()
        assert copied.read_bytes() == (source / managed_file.blob.name).read_bytes()


def test_a_second_run_skips_objects_that_are_already_present(
    media_roots: tuple[Path, Path], settings: Any
) -> None:
    source, destination = media_roots
    _stored_files(settings, source, destination)

    assert _migrate(source)["copied"] == 3
    repeat = _migrate(source)

    assert repeat["copied"] == 0
    assert repeat["skipped_present"] == 3


def test_overwrite_replaces_a_destination_object_in_place(
    media_roots: tuple[Path, Path], settings: Any
) -> None:
    source, destination = media_roots
    files = _stored_files(settings, source, destination)
    _migrate(source)
    stale = destination / files[0].blob.name
    stale.write_bytes(b"%PDF-1.7 stale")

    evidence = _migrate(source, "--overwrite", "--verify-checksum")

    assert evidence["copied"] == 3
    assert evidence["mismatched"] == []
    assert stale.read_bytes() == (source / files[0].blob.name).read_bytes()


def test_a_dry_run_reports_the_work_without_writing(
    media_roots: tuple[Path, Path], settings: Any
) -> None:
    source, destination = media_roots
    _stored_files(settings, source, destination)

    evidence = _migrate(source, "--dry-run")

    assert evidence["copied"] == 3
    assert not list(destination.rglob("*.pdf"))


def test_a_missing_source_object_is_reported_rather_than_fatal(
    media_roots: tuple[Path, Path], settings: Any
) -> None:
    source, destination = media_roots
    files = _stored_files(settings, source, destination)
    (source / files[0].blob.name).unlink()

    evidence = _migrate(source)

    assert evidence["missing_source"] == 1
    assert evidence["copied"] == 2


def test_the_limit_bounds_a_rehearsal_batch(media_roots: tuple[Path, Path], settings: Any) -> None:
    source, destination = media_roots
    _stored_files(settings, source, destination)

    evidence = _migrate(source, "--limit", "2")

    assert evidence["examined"] == 2
    assert evidence["copied"] == 2


def test_corrupted_bytes_fail_the_checksum_gate(
    media_roots: tuple[Path, Path], settings: Any
) -> None:
    source, destination = media_roots
    files = _stored_files(settings, source, destination)
    files[0].checksum_sha256 = "0" * 64
    files[0].save(update_fields=["checksum_sha256"])

    with pytest.raises(CommandError, match="checksum verification"):
        _migrate(source, "--verify-checksum")


def test_a_filesystem_destination_is_refused_without_an_explicit_opt_in(
    media_roots: tuple[Path, Path], settings: Any
) -> None:
    source, destination = media_roots
    _stored_files(settings, source, destination)

    with pytest.raises(CommandError, match="STORAGE_BACKEND=s3"):
        call_command("migrate_managed_files", "--media-root", str(source), stdout=StringIO())


def test_a_missing_source_directory_is_refused(settings: Any, tmp_path: Path) -> None:
    with pytest.raises(CommandError, match="does not exist"):
        call_command(
            "migrate_managed_files",
            "--media-root",
            str(tmp_path / "absent"),
            "--allow-filesystem-destination",
            stdout=StringIO(),
        )

#!/usr/bin/env python3
"""Atomically unpack a streamed tar archive into a confined directory and
verify every extracted PDF on disk against manifest.json SHA-256 checksums.

Guarantees:
- Refuses any target outside /home/lockin/production_pdfs.
- Refuses to overwrite a non-empty target directory.
- Stages extraction in a private temp directory so failures leave no empty
  archive artifacts or partial files in the destination directory.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import BinaryIO

ALLOWED_BASE = Path("/home/lockin/production_pdfs").resolve()
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$")
REQUIRED_METADATA = ("manifest.json", "live_physiology_report.json")


def validate_dest_dir(dest_dir: Path, *, allowed_base: Path = ALLOWED_BASE) -> Path:
    resolved = dest_dir.resolve()
    if resolved == allowed_base or allowed_base not in resolved.parents:
        raise ValueError(
            f"Destination directory {resolved} must be a subdirectory strictly inside {allowed_base}."
        )
    return resolved


def safe_unpack_and_verify(
    stream: BinaryIO,
    dest_dir: Path,
    *,
    allowed_base: Path = ALLOWED_BASE,
    require_report: bool = True,
) -> list[dict[str, object]]:
    target = validate_dest_dir(dest_dir, allowed_base=allowed_base)
    if target.exists():
        if not target.is_dir():
            raise FileExistsError(f"Destination exists and is not a directory: {target}")
        if any(target.iterdir()):
            raise FileExistsError(
                f"Destination {target} is not empty; refusing to overwrite existing files."
            )

    target.parent.mkdir(parents=True, exist_ok=True)
    staging_parent = target.parent
    staging_dir = Path(tempfile.mkdtemp(prefix=f".staging_{target.name}_", dir=staging_parent))
    os.chmod(staging_dir, 0o700)

    try:
        extracted_names: set[str] = set()
        try:
            with tarfile.open(fileobj=stream, mode="r|*") as archive:
                for member in archive:
                    if not member.isreg():
                        raise ValueError(f"Refusing non-regular tar member: {member.name!r}")
                    if not SAFE_NAME_RE.match(member.name) or ".." in member.name:
                        raise ValueError(f"Refusing unsafe tar member path: {member.name!r}")
                    dest_path = (staging_dir / member.name).resolve()
                    if dest_path.parent != staging_dir.resolve():
                        raise ValueError(f"Path traversal blocked for {member.name!r}")
                    if dest_path.exists():
                        raise FileExistsError(f"Duplicate tar member {member.name!r}")
                    src = archive.extractfile(member)
                    if src is None:
                        raise ValueError(f"Unable to read tar member stream for {member.name!r}")
                    with dest_path.open("wb") as out:
                        for chunk in iter(lambda: src.read(1024 * 1024), b""):
                            out.write(chunk)
                    os.chmod(dest_path, 0o600)
                    extracted_names.add(member.name)
        except tarfile.TarError as exc:
            raise ValueError(f"Invalid or empty tar stream: {exc}") from exc

        if not extracted_names:
            raise ValueError("Empty tar stream received; no files were extracted.")

        required = REQUIRED_METADATA if require_report else ("manifest.json",)
        for req in required:
            if req not in extracted_names or not (staging_dir / req).is_file():
                raise FileNotFoundError(f"Missing required {req} in extracted archive.")

        manifest = json.loads((staging_dir / "manifest.json").read_text(encoding="utf-8"))
        verified: list[dict[str, object]] = []
        for entry in manifest.get("files", []):
            name = str(entry["archive_name"])
            if name not in extracted_names:
                raise FileNotFoundError(f"Missing PDF listed in manifest: {name}")
            pdf_path = (staging_dir / name).resolve()
            if pdf_path.parent != staging_dir.resolve() or not pdf_path.is_file():
                raise FileNotFoundError(f"Invalid extracted PDF path: {pdf_path}")
            digest = hashlib.sha256()
            with pdf_path.open("rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    digest.update(chunk)
            disk_sha = digest.hexdigest()
            expected_sha = str(entry["checksum"])
            if disk_sha != expected_sha:
                raise ValueError(
                    f"Disk SHA-256 mismatch for {name}: expected {expected_sha}, got {disk_sha}"
                )
            verified.append({"file": name, "sha256": disk_sha, "bytes": pdf_path.stat().st_size})

        if target.exists():
            # Verified empty above; remove only so atomic rename can place staging_dir
            target.rmdir()
        staging_dir.replace(target)
        os.chmod(target, 0o700)
        return verified
    finally:
        if staging_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("Usage: safe_extract_tar_stream.py <dest_dir>\n")
        return 2
    verified = safe_unpack_and_verify(sys.stdin.buffer, Path(sys.argv[1]))
    print(f"Verified {len(verified)} PDF(s) via SHA-256 on disk:")
    for item in verified:
        print(f"  - {item['file']} ({item['bytes']} bytes) sha256={item['sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Safely unpack the streamed tar archive into a confined target directory
and verify every extracted PDF on disk against manifest.json SHA-256 checksums.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tarfile
from pathlib import Path
from typing import BinaryIO

ALLOWED_BASE = Path("/home/lockin/production_pdfs").resolve()
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$")


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
) -> list[dict[str, object]]:
    target = validate_dest_dir(dest_dir, allowed_base=allowed_base)
    target.mkdir(parents=True, exist_ok=True)
    os.chmod(target, 0o700)

    extracted_names: set[str] = set()
    with tarfile.open(fileobj=stream, mode="r|*") as archive:
        for member in archive:
            if not member.isreg():
                raise ValueError(f"Refusing non-regular tar member: {member.name!r}")
            if not SAFE_NAME_RE.match(member.name) or ".." in member.name:
                raise ValueError(f"Refusing unsafe tar member path: {member.name!r}")
            dest_path = (target / member.name).resolve()
            if dest_path.parent != target:
                raise ValueError(f"Path traversal blocked for {member.name!r}")
            src = archive.extractfile(member)
            if src is None:
                raise ValueError(f"Unable to read tar member stream for {member.name!r}")
            tmp_path = target / f".tmp.{member.name}"
            with tmp_path.open("wb") as out:
                for chunk in iter(lambda: src.read(1024 * 1024), b""):
                    out.write(chunk)
            os.chmod(tmp_path, 0o600)
            tmp_path.replace(dest_path)
            extracted_names.add(member.name)

    manifest_path = target / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Missing manifest.json in {target}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    verified: list[dict[str, object]] = []
    for entry in manifest.get("files", []):
        name = str(entry["archive_name"])
        if name not in extracted_names:
            raise FileNotFoundError(f"Missing PDF listed in manifest: {name}")
        pdf_path = (target / name).resolve()
        if pdf_path.parent != target or not pdf_path.is_file():
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
    return verified


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

#!/usr/bin/env python3
"""Prove the layer-order contract of the backend and edge images.

A release that changes only application code must reuse every dependency layer
byte for byte, so a host that already runs the previous release downloads the
application and nothing more. A change to the dependency definition must still
rebuild those layers. Both properties depend only on the order of steps in the
Dockerfiles, so this builds real images and asserts them:

  A  reference build
  B  application source changed           -> dependency layers identical to A
  C  only tool configuration changed      -> dependency layers identical to A
  D  dependency definition changed        -> dependency layers rebuilt

Layer identity is the uncompressed diff_id from the image config, the digest a
registry pull skips when the host already has it.

--reference REF also builds the Dockerfiles as they were at REF from the same
source, measures what a source-only release cost under them, and proves the new
images carry exactly the same installed and served files.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EDGE_BUILD_ARGS = [
    "--build-arg", "VITE_APP_VERSION=layer-probe",
    "--build-arg", "VITE_SUPPORT_EMAIL=support@lockin.example.test",
    "--build-arg", "VITE_LEGAL_ENTITY=Lock-in CI",
    "--build-arg", "VITE_LEGAL_ADDRESS=CI test address",
    "--build-arg", "VITE_LEGAL_JURISDICTION=CI test jurisdiction",
    "--build-arg", "VITE_POLICY_VERSION=ci-policy-v1",
]
# Steps that identify the layers under test. Each must match exactly one row.
BACKEND_DEPENDENCY_INSTALL = "--requirement /tmp/requirements.txt"
BACKEND_SOURCE_COPY = "COPY --chown=lockin:lockin apps ./apps"
EDGE_PUBLIC_COPY = "COPY /app/dist-public /usr/share/nginx/html"
EDGE_BUNDLE_COPY = "COPY /app/dist /usr/share/nginx/html"

failures: list[str] = []
summary: list[str] = []
summary_notes: list[str] = []


def mb(size: int) -> str:
    return f"{size / 1_048_576:.1f} MB"


def check(condition: bool, message: str) -> None:
    print(("PASS  " if condition else "FAIL  ") + message, flush=True)
    if not condition:
        failures.append(message)


def build(context: Path, tag: str, *, dockerfile: Path | None = None, args: list[str] | None = None) -> str:
    command = ["docker", "build", "--progress=plain", "--tag", tag, *(args or [])]
    if dockerfile is not None:
        command += ["--file", str(dockerfile)]
    command.append(str(context))
    print(f"\n$ {' '.join(command)}", flush=True)
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    log = result.stdout + result.stderr
    if result.returncode:
        print(log[-12_000:])
        raise SystemExit(f"build failed: {tag}\n{log[-1_500:]}")
    return log


def step_cached(log: str, needle: str) -> bool:
    """Whether the BuildKit vertex whose command contains `needle` was CACHED."""
    vertices = [match.group(1) for match in re.finditer(r"^#(\d+) \[[^\]]+\] (.*)$", log, re.M) if needle in match.group(2)]
    if not vertices:
        raise SystemExit(f"no build step matches {needle!r}")
    return all(re.search(rf"^#{vertex} CACHED$", log, re.M) for vertex in vertices)


def layers(image: str) -> list[dict[str, object]]:
    """The image's layers, each with the step that created it and its size."""
    with tempfile.TemporaryDirectory() as directory:
        archive = Path(directory) / "image.tar"
        subprocess.run(["docker", "image", "save", "--output", str(archive), image], check=True)
        with tarfile.open(archive) as saved:
            manifest = json.load(saved.extractfile("manifest.json"))[0]
            config = json.load(saved.extractfile(manifest["Config"]))
            sizes = [saved.getmember(path).size for path in manifest["Layers"]]
    steps = [item.get("created_by", "") for item in config["history"] if not item.get("empty_layer")]
    diff_ids = config["rootfs"]["diff_ids"]
    if len(steps) != len(diff_ids):
        raise SystemExit(f"{image}: history does not align with its layers")
    return [
        {"step": re.sub(r"\s+", " ", step).replace(" # buildkit", ""), "diff_id": diff_id, "size": size}
        for step, diff_id, size in zip(steps, diff_ids, sizes, strict=True)
    ]


def row(rows: list[dict[str, object]], needle: str) -> int:
    matches = [index for index, item in enumerate(rows) if needle in str(item["step"])]
    if len(matches) != 1:
        raise SystemExit(f"expected one layer created by {needle!r}, found {len(matches)}")
    return matches[0]


def ids(rows: list[dict[str, object]]) -> list[object]:
    return [item["diff_id"] for item in rows]


def new_bytes(previous: list[dict[str, object]], current: list[dict[str, object]]) -> tuple[int, int]:
    """Bytes and layers a host holding `previous` must fetch to run `current`."""
    held = {item["diff_id"] for item in previous}
    fresh = [item for item in current if item["diff_id"] not in held]
    return sum(int(item["size"]) for item in fresh), len(fresh)


def table(title: str, base: list[dict[str, object]], other: list[dict[str, object]]) -> None:
    held = {item["diff_id"] for item in base}
    print(f"\n{title}")
    for item in other:
        state = "reused " if item["diff_id"] in held else "CHANGED"
        print(f"  {state} {str(item['diff_id'])[7:19]} {mb(int(item['size'])):>9}  {str(item['step'])[:96]}")


def mutate(path: Path, text: str) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(text)


def add_dependency(pyproject: Path) -> None:
    content = pyproject.read_text(encoding="utf-8")
    updated = content.replace('dependencies = [\n', 'dependencies = [\n  "six==1.17.0",\n', 1)
    if updated == content:
        raise SystemExit("could not add a probe dependency to pyproject.toml")
    pyproject.write_text(updated, encoding="utf-8")


def backend(work: Path, reference: str | None) -> None:
    context = work / "backend"
    shutil.copytree(ROOT / "backend", context, ignore=shutil.ignore_patterns(".venv", "__pycache__", "*.sqlite3", "media"))
    build(context, "layers/backend:a")
    a = layers("layers/backend:a")

    mutate(context / "config" / "urls.py", "\n# layer-stability probe: application source only\n")
    log_b = build(context, "layers/backend:b")
    b = layers("layers/backend:b")
    table("backend B (source only) vs A", a, b)
    install = row(a, BACKEND_DEPENDENCY_INSTALL)
    check(ids(a[: install + 1]) == ids(b[: install + 1]), "backend B: every layer through the dependency install is identical to A")
    check(a[row(a, "mkdir -p /app/media")]["diff_id"] == b[row(b, "mkdir -p /app/media")]["diff_id"], "backend B: the writable-directory layer is identical to A")
    check(a[row(a, BACKEND_SOURCE_COPY)]["diff_id"] != b[row(b, BACKEND_SOURCE_COPY)]["diff_id"], "backend B: the application source layer changed")
    check(step_cached(log_b, "pip wheel --wheel-dir=/wheels --requirement"), "backend B: BuildKit reported the dependency wheel build CACHED")
    check(step_cached(log_b, BACKEND_DEPENDENCY_INSTALL), "backend B: BuildKit reported the dependency install CACHED")
    source_only, source_only_layers = new_bytes(a, b)

    mutate(context / "pyproject.toml", "\n[tool.layer_probe]\nvalue = 1\n")
    log_c = build(context, "layers/backend:c")
    c = layers("layers/backend:c")
    check(a[install]["diff_id"] == c[row(c, BACKEND_DEPENDENCY_INSTALL)]["diff_id"], "backend C: a tool-configuration edit leaves the dependency install identical")
    check(step_cached(log_c, "pip wheel --wheel-dir=/wheels --requirement"), "backend C: dependency wheels CACHED after a tool-configuration edit")

    add_dependency(context / "pyproject.toml")
    log_d = build(context, "layers/backend:d")
    d = layers("layers/backend:d")
    check(a[install]["diff_id"] != d[row(d, BACKEND_DEPENDENCY_INSTALL)]["diff_id"], "backend D: a dependency change rebuilds the dependency install")
    check(not step_cached(log_d, "pip wheel --wheel-dir=/wheels --requirement"), "backend D: dependency wheels rebuilt, not CACHED")

    runtime("layers/backend:a")
    total = sum(int(item["size"]) for item in a)
    summary.append(f"| backend | {len(a)} | {mb(total)} | {mb(source_only)} in {source_only_layers} layers |")

    if reference:
        old_dockerfile = work / "backend.reference.Dockerfile"
        old_dockerfile.write_text(subprocess.run(["git", "-C", str(ROOT), "show", f"{reference}:backend/Dockerfile"], check=True, text=True, capture_output=True).stdout, encoding="utf-8")
        pristine = work / "backend-reference"
        shutil.copytree(ROOT / "backend", pristine, ignore=shutil.ignore_patterns(".venv", "__pycache__", "*.sqlite3", "media"))
        build(pristine, "layers/backend-old:a", dockerfile=old_dockerfile)
        old_a = layers("layers/backend-old:a")
        mutate(pristine / "config" / "urls.py", "\n# layer-stability probe: application source only\n")
        build(pristine, "layers/backend-old:b", dockerfile=old_dockerfile)
        old_b = layers("layers/backend-old:b")
        table(f"backend B vs A under the Dockerfile at {reference}", old_a, old_b)
        old_source_only, old_layers = new_bytes(old_a, old_b)
        old_total = sum(int(item["size"]) for item in old_a)
        summary.append(f"| backend at {reference[:7]} | {len(old_a)} | {mb(old_total)} | {mb(old_source_only)} in {old_layers} layers |")
        equivalent_backend("layers/backend-old:a", "layers/backend:a")


def runtime(image: str) -> None:
    inspect = json.loads(subprocess.run(["docker", "image", "inspect", image], check=True, text=True, capture_output=True).stdout)[0]["Config"]
    check(inspect["Cmd"] == ["gunicorn", "--config", "config/gunicorn.py", "config.wsgi:application"], "backend: the command is unchanged")
    check(inspect["User"] == "10001:10001" and inspect["WorkingDir"] == "/app", "backend: runs as 10001:10001 from /app")
    check(list(inspect.get("ExposedPorts", {})) == ["8000/tcp"], "backend: exposes 8000 only")
    probe = "import django, rest_framework, gunicorn, psycopg, storages, jwt, config, apps, platform_core; print(django.get_version())"
    result = subprocess.run(["docker", "run", "--rm", image, "python", "-c", probe], text=True, capture_output=True, check=False)
    check(result.returncode == 0 and result.stdout.strip() == "5.2.17", f"backend: imports resolve and Django is 5.2.17 ({result.stdout.strip() or result.stderr.strip()[-200:]})")
    result = subprocess.run(["docker", "run", "--rm", image, "python", "-m", "pip", "check"], text=True, capture_output=True, check=False)
    check(result.returncode == 0, f"backend: pip check reports no broken requirements ({result.stdout.strip()[-200:]})")
    result = subprocess.run(["docker", "run", "--rm", image, "sh", "-c", "test ! -e /wheels && test ! -e /tmp/wheels && stat -c '%u' /app/media /app/staticfiles"], text=True, capture_output=True, check=False)
    check(result.returncode == 0 and result.stdout.split() == ["10001", "10001"], "backend: no wheel archives ship, and the writable directories belong to 10001")


TREE_PROBE = r"""
import hashlib, json, os, sys, sysconfig
roots = ["/app", sysconfig.get_paths()["purelib"], sysconfig.get_paths()["scripts"]]
tree = {}
for root in roots:
    for directory, folders, files in os.walk(root):
        folders[:] = sorted(item for item in folders if item != "__pycache__")
        for name in files:
            if name.endswith(".pyc"):
                continue
            path = os.path.join(directory, name)
            info = os.lstat(path)
            with open(path, "rb") as handle:
                tree[path] = [hashlib.sha256(handle.read()).hexdigest(), oct(info.st_mode), info.st_uid, info.st_gid]
print(json.dumps(tree, sort_keys=True))
"""


def equivalent_backend(old: str, new: str) -> None:
    def facts(image: str) -> tuple[str, dict[str, list[object]]]:
        freeze = subprocess.run(["docker", "run", "--rm", image, "python", "-m", "pip", "freeze"], check=True, text=True, capture_output=True).stdout
        tree = subprocess.run(["docker", "run", "--rm", image, "python", "-c", TREE_PROBE], check=True, text=True, capture_output=True).stdout
        return freeze, json.loads(tree)

    old_freeze, old_tree = facts(old)
    new_freeze, new_tree = facts(new)
    check(old_freeze == new_freeze, f"backend equivalence: pip freeze is identical ({len(new_freeze.splitlines())} distributions)")
    # Installing from a requirements file marks those distributions as
    # user-requested, which pip records as an empty dist-info/REQUESTED file.
    # Only pip reads it (`pip list --not-required`); it is reported, not hidden.
    requested = sorted(path for path in set(old_tree) ^ set(new_tree) if path.endswith(".dist-info/REQUESTED"))
    differing = sorted(
        path for path in set(old_tree) | set(new_tree)
        if old_tree.get(path) != new_tree.get(path) and path not in requested
    )
    check(not differing, f"backend equivalence: /app, site-packages and console scripts are identical in content, mode and owner ({len(new_tree)} files){'; differs: ' + ', '.join(differing[:8]) if differing else ''}")
    print(f"NOTE  backend equivalence: {len(requested)} pip REQUESTED markers differ (metadata pip alone reads): {', '.join(path.split('/')[-2] for path in requested[:12])}")
    summary_notes.append(f"{len(requested)} dist-info/REQUESTED markers differ between the old and new backend images; no other file does")


def edge(work: Path, reference: str | None) -> None:
    context = work / "frontend"
    shutil.copytree(ROOT / "frontend", context, ignore=shutil.ignore_patterns("node_modules", "dist", "dev-dist", "test-results", "playwright-report", "output"))
    build(context, "layers/edge:a", args=EDGE_BUILD_ARGS)
    a = layers("layers/edge:a")

    mutate(context / "src" / "main.jsx", "\n// layer-stability probe: application source only\n")
    log_b = build(context, "layers/edge:b", args=EDGE_BUILD_ARGS)
    b = layers("layers/edge:b")
    table("edge B (source only) vs A", a, b)
    check(step_cached(log_b, "pnpm install --frozen-lockfile"), "edge B: BuildKit reported the dependency install CACHED")
    check(a[row(a, EDGE_PUBLIC_COPY)]["diff_id"] == b[row(b, EDGE_PUBLIC_COPY)]["diff_id"], "edge B: the public-asset layer is identical to A")
    check(a[row(a, EDGE_BUNDLE_COPY)]["diff_id"] != b[row(b, EDGE_BUNDLE_COPY)]["diff_id"], "edge B: the application bundle layer changed")
    check(ids(a[: row(a, EDGE_PUBLIC_COPY) + 1]) == ids(b[: row(b, EDGE_PUBLIC_COPY) + 1]), "edge B: every layer through the public assets is identical to A")
    source_only, source_only_layers = new_bytes(a, b)

    mutate(context / "pnpm-lock.yaml", "\n# layer-stability probe: dependency definition\n")
    log_c = build(context, "layers/edge:c", args=EDGE_BUILD_ARGS)
    check(not step_cached(log_c, "pnpm install --frozen-lockfile"), "edge C: a lockfile change reruns the dependency install")

    inspect = json.loads(subprocess.run(["docker", "image", "inspect", "layers/edge:a"], check=True, text=True, capture_output=True).stdout)[0]["Config"]
    check(inspect["Cmd"] == ["nginx", "-g", "daemon off;"] and inspect["User"] == "10001:10001", "edge: command and unprivileged user are unchanged")
    total = sum(int(item["size"]) for item in a)
    summary.append(f"| edge | {len(a)} | {mb(total)} | {mb(source_only)} in {source_only_layers} layers |")

    if reference:
        old_dockerfile = work / "frontend.reference.Dockerfile"
        old_dockerfile.write_text(subprocess.run(["git", "-C", str(ROOT), "show", f"{reference}:frontend/Dockerfile"], check=True, text=True, capture_output=True).stdout, encoding="utf-8")
        pristine = work / "frontend-reference"
        shutil.copytree(ROOT / "frontend", pristine, ignore=shutil.ignore_patterns("node_modules", "dist", "dev-dist", "test-results", "playwright-report", "output"))
        build(pristine, "layers/edge-old:a", dockerfile=old_dockerfile, args=EDGE_BUILD_ARGS)
        old_a = layers("layers/edge-old:a")
        mutate(pristine / "src" / "main.jsx", "\n// layer-stability probe: application source only\n")
        build(pristine, "layers/edge-old:b", dockerfile=old_dockerfile, args=EDGE_BUILD_ARGS)
        old_b = layers("layers/edge-old:b")
        table(f"edge B vs A under the Dockerfile at {reference}", old_a, old_b)
        old_source_only, old_layers = new_bytes(old_a, old_b)
        summary.append(f"| edge at {reference[:7]} | {len(old_a)} | {mb(sum(int(item['size']) for item in old_a))} | {mb(old_source_only)} in {old_layers} layers |")
        listing = "cd /usr/share/nginx/html && find . -type f -exec sha256sum {} + | sort -k2 && find . -exec stat -c '%a %u %g %n' {} + | sort -k4"
        old_tree = subprocess.run(["docker", "run", "--rm", "--entrypoint", "sh", "layers/edge-old:a", "-c", listing], check=True, text=True, capture_output=True).stdout
        new_tree = subprocess.run(["docker", "run", "--rm", "--entrypoint", "sh", "layers/edge:a", "-c", listing], check=True, text=True, capture_output=True).stdout
        check(old_tree == new_tree, f"edge equivalence: the served tree is identical in content, mode and owner ({old_tree.count(chr(10)) // 2} entries)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reference", help="git ref whose Dockerfiles to compare against (one-off evidence runs)")
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="layer-stability-") as directory:
        work = Path(directory)
        backend(work, options.reference)
        edge(work, options.reference)

    lines = ["| image | layers | size (uncompressed) | a source-only release adds |", "|---|---|---|---|", *summary]
    print("\n" + "\n".join(lines))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as handle:
            handle.write("### Image layer stability\n\n" + "\n".join(lines) + "\n")
    if os.environ.get("GITHUB_ACTIONS"):
        for line in summary:
            print(f"::notice title=Layer stability::{line.strip('| ').replace(' | ', ' / ')}")
        for note in summary_notes:
            print(f"::notice title=Layer stability::{note}")
        print(f"::notice title=Layer stability::{len(failures)} failed of the checks run")
    if failures:
        for failure in failures:
            print(f"::error title=Layer stability::{failure}")
        sys.exit(1)


def annotate_fatal(message: str) -> None:
    """Surface a stopping error where the check-run API shows it, not only in the log."""
    if os.environ.get("GITHUB_ACTIONS"):
        encoded = message.replace("%", "%25").replace("\r", "").replace("\n", "%0A")
        print(f"::error title=Layer stability stopped::{encoded}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as stop:
        if isinstance(stop.code, str):
            annotate_fatal(stop.code)
            print(stop.code, file=sys.stderr)
            sys.exit(1)
        raise
    except Exception as error:  # noqa: BLE001 - report anything that stops the proof
        annotate_fatal(f"{type(error).__name__}: {error}")
        raise

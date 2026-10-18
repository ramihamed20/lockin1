"""Prepare a loopback Nginx static-delivery comparison from both repo shapes.

Copies only the ordinary public frontend bundle into an owned temporary lab.
The generated config uses asset blocks from HEAD/current; its API upstream is
an explicitly synthetic local server. No TLS/production/private media access.
Start Nginx separately with the returned prefix; never deploy this lab config.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SHAPES = ("frontend/nginx/default.conf", "deploy/container-host/nginx.conf.template")
LOCATIONS = ("location ~ ^/assets/.*\\.mjs$", "location /assets/")
TAG = "lockin-nginx-static-lab-v1"


def location_block(source: str, marker: str) -> str:
    start = source.index(marker)
    opening = source.index("{", start)
    depth = 1
    end = opening + 1
    while depth and end < len(source):
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    if depth:
        raise ValueError("Unbalanced static location")
    return source[start:end]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nginx", type=Path, required=True, help="Local runtime executable")
    parser.add_argument("--prefix", type=Path, help="Existing lab prefix returned by this script")
    parser.add_argument("--port-base", type=int, default=8280)
    parser.add_argument("--api-port", type=int, default=4174)
    parser.add_argument("--bundle", type=Path, help="Frozen ordinary bundle within frontend/output/performance")
    parser.add_argument("--fixture-port", type=int, help="Optional synthetic PDF fixture upstream")
    parser.add_argument("--state", type=Path, help="Separate state artifact within frontend/output/performance")
    args = parser.parse_args()
    if not 1024 <= args.port_base <= 65530 or not 1024 <= args.api_port <= 65535:
        parser.error("Use unprivileged local ports")
    artifact_root = (REPO / "frontend/output/performance").resolve()
    bundle = (args.bundle or artifact_root / "production-dist").resolve()
    if not bundle.is_relative_to(artifact_root):
        parser.error("Bundle must be a frozen local performance artifact")
    if args.fixture_port is not None and not 1024 <= args.fixture_port <= 65535:
        parser.error("Use an unprivileged local fixture port")
    output = (args.state or artifact_root / "nginx-lab-state.json").resolve()
    if not output.is_relative_to(artifact_root):
        parser.error("State must stay within local performance artifacts")
    fixture_location = (
        f"location /e2e-fixtures/pdf/ {{ proxy_pass http://127.0.0.1:{args.fixture_port}; "
        'proxy_buffering off; proxy_cache off; add_header Cache-Control "private, no-store" always; }'
        if args.fixture_port is not None else ""
    )
    if not (bundle / "index.html").is_file():
        parser.error("Ordinary benchmark bundle is missing")
    runtime = args.nginx.resolve()
    if runtime.name not in {"nginx", "nginx.exe"}:
        parser.error("Use an explicit local Nginx runtime")
    git = shutil.which("git")
    if git is None:
        parser.error("Git executable is missing")
    mime = runtime.parent / "conf/mime.types"
    if not runtime.is_file() or not mime.is_file():
        parser.error("Nginx runtime/mime.types are missing")
    prefix = (
        args.prefix.resolve()
        if args.prefix
        else Path(tempfile.mkdtemp(prefix="lockin-nginx-static-")).resolve()
    )
    if prefix.parent != Path(tempfile.gettempdir()).resolve() or not prefix.name.startswith(
        "lockin-nginx-static-"
    ):
        parser.error("Prefix must be the owned temporary static lab")
    marker = prefix / "owner.json"
    if args.prefix:
        if not marker.is_file() or json.loads(marker.read_text())["tag"] != TAG:
            parser.error("Existing prefix is not an owned static lab")
    else:
        marker.write_text(json.dumps({"tag": TAG}), encoding="utf8")
        shutil.copytree(bundle, prefix / "html")
    for name in ("conf", "logs", "temp"):
        (prefix / name).mkdir(exist_ok=True)
    shutil.copyfile(mime, prefix / "conf/mime.types")
    servers, variants = [], []
    for shape_index, relative in enumerate(SHAPES):
        current = (REPO / relative).read_text(encoding="utf8")
        baseline = subprocess.check_output(  # noqa: S603 - resolved Git, fixed read-only argv
            [git, "show", "HEAD:" + relative], cwd=REPO, encoding="utf8"
        )
        security = "\n".join(
            line for line in current.splitlines() if line.startswith("    add_header ")
        )
        for variant_index, (label, source) in enumerate((("head", baseline), ("current", current))):
            port = args.port_base + shape_index * 2 + variant_index
            blocks = "\n".join(location_block(source, location) for location in LOCATIONS)
            servers.append(f"""server {{
listen 127.0.0.1:{port};
server_name localhost;
root html;
{security}
{blocks}
location /api/ {{ proxy_pass http://127.0.0.1:{args.api_port}; proxy_buffering off; }}
{fixture_location}
location = /service-worker.js {{ expires epoch; try_files $uri =404; }}
location / {{ try_files $uri $uri/ /index.html; expires -1; }}
}}""")
            variants.append(
                {
                    "shape": relative,
                    "variant": label,
                    "url": f"http://127.0.0.1:{port}",
                    "assetBlockSha256": hashlib.sha256(blocks.encode()).hexdigest(),
                }
            )
    config = (
        "worker_processes 1;\npid logs/nginx.pid;\nerror_log logs/error.log warn;\n"
        "events { worker_connections 128; }\n"
        "http { include mime.types; default_type application/octet-stream; access_log off;\n"
        + "\n".join(servers)
        + "\n}\n"
    )
    (prefix / "conf/static-lab.conf").write_text(config, encoding="utf8")
    # Explicit argv; syntax check touches only this owned prefix/config.
    subprocess.run(  # noqa: S603 - validated local runtime/prefix, explicit argv, no shell
        [str(runtime), "-t", "-p", prefix.as_posix() + "/", "-c", "conf/static-lab.conf"],
        check=True,
    )
    state = {
        "prefix": str(prefix),
        "runtime": str(runtime),
        "variants": variants,
        "bundleRoot": str(bundle),
        "fixturePort": args.fixture_port,
        "bundleIndexSha256": hashlib.sha256((prefix / "html/index.html").read_bytes()).hexdigest(),
        "limitations": (
            "static location snippets under loopback HTTP; no production TLS, "
            "Linux container permissions, real backend, edge or private media"
        ),
    }
    output.write_text(json.dumps(state, indent=2), encoding="utf8")
    print(json.dumps(state, indent=2))


if __name__ == "__main__":
    main()

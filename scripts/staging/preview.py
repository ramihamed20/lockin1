"""Expose the existing isolated staging app through a token-free HTTPS tunnel."""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import time
import sys

from validate import preview_host, validate

ROOT = Path(__file__).resolve().parents[2]


def tunnel_host(logs):
    for host in re.findall(r"https://([a-z0-9-]+\.trycloudflare\.com)(?=[\s/|]|$)", logs):
        if preview_host(host):
            return host
    return None


def set_host(path, host):
    if not preview_host(host):
        raise ValueError("Invalid staging hostname")
    original = path.read_text()
    if len(re.findall(r"^LOCKIN_PUBLIC_HOST=.*$", original, re.M)) != 1:
        raise ValueError("Expected one LOCKIN_PUBLIC_HOST in .env.staging")
    updated = re.sub(r"^LOCKIN_PUBLIC_HOST=.*$", f"LOCKIN_PUBLIC_HOST={host}", original, flags=re.M)
    temporary = path.with_name(path.name + ".preview-tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w") as stream:
            stream.write(updated)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run with sudo.")
    os.chdir(ROOT)
    # Serialize URL changes without exposing the private environment file.
    with (ROOT / ".runtime/staging/preview.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        run_preview(dev="--dev" in sys.argv[1:])


def run_preview(dev=False):
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "DOCKER_CONFIG") if key in os.environ}
    command = ["docker", "--context", "default", "compose", "-p", "lockin-staging",
               "--env-file", ".env.staging", "-f", "compose.production.yaml",
               "-f", "compose.staging.yaml", "--profile", "staging-quick", "--profile", "staging-tunnel"]
    dev_marker = ROOT / ".runtime/staging/dev-enabled"
    if dev or dev_marker.exists():
        command += ["-f", "compose.staging-dev.yaml"]

    def compose(*args, capture=False, timeout=180):
        return subprocess.run(command + list(args), env=environment, check=True, text=True,
                              stdout=subprocess.PIPE if capture else None, timeout=timeout).stdout

    validate(json.loads(compose("config", "--format", "json", capture=True)))
    if not compose("ps", "--status", "running", "-q", "backend", capture=True).strip():
        raise SystemExit("Start staging first with control.sh start.")
    if dev or dev_marker.exists():
        print("Starting live frontend; first dependency installation can take several minutes...", flush=True)
        compose("pull", "frontend-dev")
        compose("up", "-d", "--no-deps", "--wait", "--wait-timeout", "600", "frontend-dev", timeout=650)
        dev_marker.touch(mode=0o600)
    print("Preparing temporary HTTPS preview (usually under a minute)...", flush=True)
    compose("pull", "quick-tunnel")
    # A fresh container avoids reading a stale URL from a previous process's logs.
    compose("up", "-d", "--no-deps", "--force-recreate", "quick-tunnel")
    host = None
    for _ in range(30):
        host = tunnel_host(compose("logs", "--no-color", "--tail", "100", "quick-tunnel", capture=True))
        if host:
            break
        time.sleep(2)
    if not host:
        raise SystemExit("No preview URL received. Check: sudo docker logs lockin-staging-quick-tunnel-1")
    set_host(ROOT / ".env.staging", host)
    validate(json.loads(compose("config", "--format", "json", capture=True)))
    # Existing application image, database, signing keys and access gate are retained.
    compose("up", "-d", "--no-deps", "--pull", "never", "--wait", "--wait-timeout", "90", "backend", "mailpit", "edge")
    compose("stop", "tunnel")
    print(f"\nPreview URL: https://{host}", flush=True)
    print("Access credentials: sudo cat ~/lockin-staging/.runtime/staging/access.txt")
    print("Temporary URL; run this command again if the tunnel stops. Production is unchanged.")
    if dev_marker.exists():
        print("Live frontend enabled: saving files in ~/lockin-staging/frontend updates this page.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, AssertionError, subprocess.SubprocessError) as error:
        raise SystemExit(f"Preview setup did not finish: {error}") from error

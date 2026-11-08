"""Save a Cloudflare Docker-command token privately, then restart staging ingress."""
import base64
import binascii
import getpass
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]


def extract_token(value):
    try:
        parts = shlex.split(value.strip())
        if "--token" in parts:
            candidate = parts[parts.index("--token") + 1]
        else:
            candidate = next(
                (part.split("=", 1)[1] for part in parts if part.startswith("--token=")),
                parts[0] if len(parts) == 1 else "",
            )
        raw = base64.b64decode(
            candidate + "=" * (-len(candidate) % 4), altchars=b"-_", validate=True
        )
        payload = json.loads(raw)
        if not isinstance(payload, dict) or not all(
            isinstance(payload.get(key), str) and payload[key] for key in ("a", "s", "t")
        ):
            raise ValueError("Missing tunnel fields")
        uuid.UUID(payload["t"])
        if not base64.b64decode(payload["s"], validate=True):
            raise ValueError("Missing tunnel secret")
        return base64.b64encode(raw).decode()
    except (ValueError, TypeError, IndexError, binascii.Error):
        # Never include the supplied command, token, or decoded payload in errors.
        raise ValueError("Invalid input. Copy the full Docker command from Cloudflare.") from None


def save_token(path, token):
    if path.parent.stat().st_mode & 0o077:
        raise ValueError("The staging secret directory must be private (mode 0700).")
    # Preserve the inode: the running Docker secret bind mount must see the new bytes.
    path.write_text(token + "\n")
    path.chmod(0o444)


def main():
    if os.geteuid() != 0:
        raise SystemExit("Run with sudo.")
    if not sys.stdin.isatty():
        raise SystemExit("Run this command directly in the Termius terminal.")
    if not (ROOT / ".env.staging").is_file():
        raise SystemExit("Staging has not been prepared in this checkout.")
    container = "lockin-staging-tunnel-1"
    result = subprocess.run(
        ["docker", "--context", "default", "inspect", "--format",
         '{{index .Config.Labels "com.docker.compose.project"}}', container],
        capture_output=True, text=True, check=True,
    )
    if result.stdout.strip() != "lockin-staging":
        raise SystemExit("Refusing to change a container outside the staging project.")
    try:
        value = getpass.getpass("Paste Cloudflare Docker command, then press Enter: ")
        token = extract_token(value)
        save_token(ROOT / ".runtime/staging/tunnel_token", token)
    except (ValueError, EOFError) as error:
        raise SystemExit(str(error)) from None
    subprocess.run(["docker", "--context", "default", "restart", container], check=True)
    print("Token format checked; saved privately; staging tunnel restarted.")


if __name__ == "__main__":
    main()

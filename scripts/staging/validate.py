"""Refuse a rendered Compose plan that can touch production state or ports."""
import json
import re
import sys


def validate(plan):
    assert plan.get("name") == "lockin-staging", "Unexpected Compose project"
    services = plan["services"]
    for name, service in services.items():
        assert not service.get("ports"), f"Host ports are forbidden: {name}"
        assert not service.get("container_name"), "Fixed container names are forbidden"
        assert service.get("network_mode") != "host", "Host networking is forbidden"
        for volume in service.get("volumes", []):
            if volume.get("type") == "bind":
                source = volume["source"]
                assert "/secure/lockin/" not in source, "Production secrets mount"
                assert not source.endswith("docker.sock"), "Docker socket mount"
    for service in ("release", "preflight", "backend") + tuple(name for name in ("operations-scheduler", "file-scan-worker") if name in services):
        env = services[service]["environment"]
        assert env["POSTGRES_HOST"] == "db", "External database forbidden"
        assert env["POSTGRES_DB"] == "lockin_staging", "Wrong database"
        assert env["DJANGO_ALLOWED_HOSTS"] == "staging.lockin.ly", "Wrong hostname"
        assert env["PUBLIC_APP_URL"] == "https://staging.lockin.ly", "Wrong app URL"
        assert env["EMAIL_HOST"] == "mailpit", "Real SMTP forbidden"
        assert env["STORAGE_BACKEND"] == "filesystem", "External storage forbidden"
        assert env["PAYMENT_PROVIDER"] == "none", "Real payment provider forbidden"
        for key in ("TELEGRAM_BOT_TOKEN", "GOOGLE_OAUTH_CLIENT_ID", "APPLE_OAUTH_SERVICES_ID", "YOUTUBE_API_KEY"):
            assert not env.get(key), f"External integration must be configured separately: {key}"
    for volume in plan.get("volumes", {}).values():
        assert not volume.get("external"), "External volume forbidden"
        assert volume.get("name", "").startswith("lockin-staging_"), "Non-staging volume"
    for network in plan.get("networks", {}).values():
        assert not network.get("external"), "External network forbidden"
        assert network.get("name", "").startswith("lockin-staging_"), "Non-staging network"
    for secret in plan.get("secrets", {}).values():
        source = secret.get("file", "")
        assert source == "/dev/null" or "/.runtime/staging/" in source, "Non-staging secret"
    for name in ("backend", "release", "preflight", "edge"):
        assert re.fullmatch(r"ghcr\.io/ramihamed20/lockin-(backend|edge):staging-[0-9a-f]{40}", services[name].get("image", "")), "Only immutable staging images are allowed"
    edge_volumes = services["edge"]["volumes"]
    assert any(v["target"] == "/run/staging/htpasswd" for v in edge_volumes), "Missing access gate"
    assert any(v["target"] == "/etc/nginx/conf.d/default.conf" and v["source"].endswith("/deploy/staging/nginx.conf") for v in edge_volumes), "Missing staging edge config"


if __name__ == "__main__":
    try:
        validate(json.load(sys.stdin))
    except (AssertionError, KeyError, TypeError, ValueError) as error:
        raise SystemExit(f"Staging isolation check failed: {error}") from error
    print("Staging isolation check passed.")

import base64
import copy
from datetime import datetime
from pathlib import Path
import tempfile
import unittest

from prepare import prepare, public_key
from validate import validate


def plan():
    env = {
        "POSTGRES_HOST": "db", "POSTGRES_DB": "lockin_staging",
        "DJANGO_ALLOWED_HOSTS": "staging.lockin.ly", "PUBLIC_APP_URL": "https://staging.lockin.ly",
        "DJANGO_CSRF_TRUSTED_ORIGINS": "https://staging.lockin.ly",
        "EMAIL_HOST": "mailpit", "STORAGE_BACKEND": "filesystem", "PAYMENT_PROVIDER": "none",
    }
    return {
        "name": "lockin-staging",
        "services": {
            **{name: {"image": "ghcr.io/ramihamed20/lockin-backend:staging-" + "a" * 40, "environment": copy.deepcopy(env)} for name in ("release", "preflight", "backend", "operations-scheduler")},
            "edge": {"image": "ghcr.io/ramihamed20/lockin-edge:staging-" + "a" * 40, "volumes": [
                {"type": "bind", "source": "/repo/.runtime/staging/htpasswd", "target": "/run/staging/htpasswd"},
                {"type": "bind", "source": "/repo/deploy/staging/nginx.conf", "target": "/etc/nginx/conf.d/default.conf"},
            ]},
        },
        "volumes": {"data": {"name": "lockin-staging_data"}},
        "networks": {"application": {"name": "lockin-staging_application"}},
        "secrets": {"django": {"file": "/repo/.runtime/staging/django"}},
    }


class IsolationTests(unittest.TestCase):
    def test_accepts_isolated_plan(self):
        validate(plan())

    def test_refuses_production_or_external_resources(self):
        mutations = [
            lambda p: p.update(name="lockin-production"),
            lambda p: p["services"]["edge"].update(ports=[{"published": "443"}]),
            lambda p: p["services"]["backend"]["environment"].update(POSTGRES_HOST="production-db"),
            lambda p: p["services"]["backend"]["environment"].update(EMAIL_HOST="smtp.zoho.com"),
            lambda p: p["services"]["backend"]["environment"].update(TELEGRAM_BOT_TOKEN="forbidden"),
            lambda p: p["volumes"]["data"].update(name="lockin-production_lockin_postgres_data"),
            lambda p: p["networks"]["application"].update(external=True),
            lambda p: p["secrets"]["django"].update(file="/secure/lockin/django_secret_key"),
            lambda p: p["services"]["edge"].update(volumes=[]),
            lambda p: p["services"]["edge"].update(image="ghcr.io/ramihamed20/lockin-edge:latest"),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                value = plan()
                mutate(value)
                with self.assertRaises(AssertionError):
                    validate(value)

    def test_new_identity_is_private_and_cannot_overwrite_existing_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            key = prepare(root, "a" * 40)
            seed = base64.b64decode((root / ".runtime/staging/offline").read_text())
            self.assertEqual(key, public_key(seed))
            self.assertEqual(len(base64.b64decode(key)), 32)
            self.assertEqual((root / ".runtime/staging").stat().st_mode & 0o777, 0o700)
            self.assertEqual((root / ".env.staging").stat().st_mode & 0o777, 0o600)
            values = dict(line.split("=", 1) for line in (root / ".env.staging").read_text().splitlines())
            # The deployment check rejects the current policy without an aware activation time.
            self.assertIsNotNone(datetime.fromisoformat(values["USER_POLICY_EFFECTIVE_AT"]).tzinfo)
            self.assertNotIn(base64.b64encode(seed).decode(), (root / ".env.staging").read_text())
            self.assertTrue((root / ".runtime/staging/htpasswd").read_text().startswith("preview:$6$"))
            with self.assertRaises(ValueError):
                prepare(root, "b" * 40)
            self.assertEqual(key, public_key(seed))

    def test_staging_keys_are_excluded_from_git_and_build_context(self):
        root = Path(__file__).resolve().parents[2]
        self.assertIn(".runtime/", (root / ".gitignore").read_text())
        self.assertIn(".runtime", (root / ".dockerignore").read_text())
        self.assertIn(".env.*", (root / ".dockerignore").read_text())

    def test_rejects_mutable_release_names(self):
        for tag in ("latest", "main", "abc", "f" * 39, "f" * 41):
            with self.subTest(tag=tag), tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(ValueError):
                    prepare(Path(tmp), tag)
                self.assertFalse((Path(tmp) / ".runtime").exists())


if __name__ == "__main__":
    unittest.main()

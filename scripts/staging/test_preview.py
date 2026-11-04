from pathlib import Path
import tempfile
import unittest

from preview import set_host, tunnel_host
from test_staging import plan
from validate import preview_host, validate


class PreviewTests(unittest.TestCase):
    def test_accepts_only_exact_preview_domains(self):
        for host in ("staging.lockin.ly", "friendly-preview.trycloudflare.com"):
            self.assertTrue(preview_host(host))
        for host in ("lockin.ly", "*.trycloudflare.com", "a.trycloudflare.com.evil.com",
                     "a.b.trycloudflare.com", "-a.trycloudflare.com", "a.trycloudflare.com,lockin.ly"):
            self.assertFalse(preview_host(host))

    def test_consistent_host_and_csrf_required(self):
        value = plan()
        host = "friendly-preview.trycloudflare.com"
        for service in value["services"].values():
            if "environment" in service:
                service["environment"].update(DJANGO_ALLOWED_HOSTS=host,
                    PUBLIC_APP_URL=f"https://{host}", DJANGO_CSRF_TRUSTED_ORIGINS=f"https://{host}")
        validate(value)
        value["services"]["backend"]["environment"]["DJANGO_CSRF_TRUSTED_ORIGINS"] = "https://lockin.ly"
        with self.assertRaises(AssertionError):
            validate(value)

    def test_extracts_cloudflared_url_without_accepting_lookalike(self):
        self.assertEqual(tunnel_host("INF | https://blue-sky.trycloudflare.com |\n"), "blue-sky.trycloudflare.com")
        self.assertIsNone(tunnel_host("https://blue-sky.trycloudflare.com.evil.com"))

    def test_host_update_preserves_other_values_and_private_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env.staging"
            path.write_text("LOCKIN_PUBLIC_HOST=staging.lockin.ly\nSECRET=keep-me\nLOCKIN_IMAGE_TAG=old-image\n")
            set_host(path, "blue-sky.trycloudflare.com")
            self.assertEqual(path.read_text(), "LOCKIN_PUBLIC_HOST=blue-sky.trycloudflare.com\nSECRET=keep-me\nLOCKIN_IMAGE_TAG=old-image\n")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(ValueError):
                set_host(path, "lockin.ly")

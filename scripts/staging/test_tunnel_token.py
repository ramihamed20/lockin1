import base64
import json
from pathlib import Path
import tempfile
import unittest
import uuid

from save_tunnel_token import extract_token, save_token


class TunnelTokenTests(unittest.TestCase):
    def setUp(self):
        self.payload = {"a": "synthetic-account", "t": str(uuid.uuid4()),
                        "s": base64.b64encode(b"x" * 32).decode()}
        self.token = base64.b64encode(json.dumps(self.payload).encode()).decode()

    def test_accepts_the_full_docker_command_and_raw_token(self):
        for value in (self.token, f"docker run image tunnel run --token {self.token}",
                      f'docker run image tunnel run --token="{self.token}"'):
            with self.subTest(value_type=value.split()[0]):
                self.assertEqual(extract_token(value), self.token)

    def test_rejects_ips_incomplete_commands_and_wrong_credentials_without_echoing_them(self):
        for value in ("41.254.65.250", "", "docker run image --token", "not-a-token",
                      "eyJzb21ldGhpbmciOiJlbHNlIn0="):
            with self.assertRaises(ValueError) as caught:
                extract_token(value)
            self.assertEqual(str(caught.exception),
                             "Invalid input. Copy the full Docker command from Cloudflare.")

    def test_validates_tunnel_id_and_secret(self):
        for key, value in (("t", "not-a-uuid"), ("s", "invalid!"), ("a", "")):
            payload = {**self.payload, key: value}
            token = base64.b64encode(json.dumps(payload).encode()).decode()
            with self.assertRaises(ValueError):
                extract_token(token)

    def test_preserves_the_secret_bind_inode_and_requires_a_private_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "token"
            path.write_text("invalid")
            inode = path.stat().st_ino
            save_token(path, self.token)
            self.assertEqual(path.stat().st_ino, inode)
            self.assertEqual(path.read_text(), self.token + "\n")
            self.assertEqual(path.stat().st_mode & 0o777, 0o444)
            Path(folder).chmod(0o755)
            with self.assertRaises(ValueError):
                save_token(path, self.token)

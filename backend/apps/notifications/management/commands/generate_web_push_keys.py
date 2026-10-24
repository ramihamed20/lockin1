import base64
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand, CommandError, CommandParser


class Command(BaseCommand):
    help = "Generate VAPID keys once; write the private key to a new owner-only file."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--private-file", required=True)

    def handle(self, *args: object, **options: object) -> None:
        del args
        key = ec.generate_private_key(ec.SECP256R1())
        private = key.private_bytes(
            serialization.Encoding.DER,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        public = key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        path = Path(str(options["private_file"]))
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w") as file:
                file.write(base64.urlsafe_b64encode(private).decode().rstrip("=") + "\n")
        except OSError as error:
            raise CommandError(
                "Could not create the private key file; existing keys are never overwritten."
            ) from error
        self.stdout.write(
            "WEB_PUSH_VAPID_PUBLIC_KEY=" + base64.urlsafe_b64encode(public).decode().rstrip("=")
        )
        self.stdout.write(f"Private key saved to {path}. Never commit or share it.")

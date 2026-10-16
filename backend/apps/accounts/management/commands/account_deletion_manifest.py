import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from django.core import signing
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.accounts.deletion_processing import begin_deletion, erase_personal_data
from apps.accounts.models import AccountDeletionRequest, OneTimeToken, User

SALT = "lockin.completed-account-deletions.v1"


class Command(BaseCommand):
    help = "Export a signed deletion journal, or replay it before reopening a restored backup."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--replay")
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--actor")

    def handle(self, *args: Any, **options: Any) -> None:
        if not options["replay"]:
            rows = list(
                AccountDeletionRequest.objects.filter(status="completed").values(
                    "id", "user_id", "retention_reason", "retained_until", "policy_version"
                )
            )
            payload = json.loads(json.dumps(rows, default=str))
            self.stdout.write(signing.dumps(payload, salt=SALT))
            return
        try:
            rows = signing.loads(Path(options["replay"]).read_text().strip(), salt=SALT)
            actor = User.objects.get(id=options["actor"]) if options["apply"] else None
            for row in rows:
                user = User.objects.filter(id=row["user_id"]).first()
                if user is None:
                    continue
                if not options["apply"]:
                    self.stdout.write(f"Replay erasure for {user.id}")
                    continue
                until = parse_datetime(row["retained_until"])
                if until is None or until <= timezone.now():
                    raise ValueError(
                        "An expired evidence hold needs operator review before restore replay."
                    )
                request = AccountDeletionRequest.objects.filter(id=row["id"]).first()
                if request is None:
                    token = OneTimeToken.objects.create(
                        user=user,
                        kind="account_deletion",
                        token_digest=uuid4().hex + uuid4().hex,
                        expires_at=timezone.now(),
                    )
                    token.used_at = timezone.now()
                    token.save(update_fields=("used_at",))
                    request = AccountDeletionRequest.objects.create(
                        id=row["id"],
                        user=user,
                        confirmation_token=token,
                        status="confirmed",
                        confirmed_at=timezone.now(),
                    )
                else:
                    request.status = "confirmed"
                    request.save(update_fields=("status",))
                if actor is None:
                    raise ValueError("An operator is required.")
                begin_deletion(
                    request_id=request.id,
                    actor=actor,
                    retention_reason=row["retention_reason"],
                    retained_until=until,
                )
                erase_personal_data(request_id=request.id, actor=actor)
        except (OSError, signing.BadSignature, ValueError, User.DoesNotExist) as error:
            raise CommandError(str(error)) from error

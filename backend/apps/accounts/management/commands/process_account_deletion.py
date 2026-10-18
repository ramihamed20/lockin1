import json
from typing import Any
from uuid import UUID

from django.core.management.base import BaseCommand, CommandError
from django.utils.dateparse import parse_datetime

from apps.accounts.deletion_processing import begin_deletion, deletion_preview, erase_personal_data
from apps.accounts.models import AccountDeletionRequest, User


class Command(BaseCommand):
    help = "Preview one verified deletion; --apply requires a reviewed legal basis and expiry."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("request_id", type=UUID)
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--actor", type=UUID)
        parser.add_argument("--retention-reason", default="")
        parser.add_argument("--retained-until", default="")

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            request = AccountDeletionRequest.objects.select_related("user").get(
                id=options["request_id"]
            )
            if not options["apply"]:
                self.stdout.write(json.dumps(deletion_preview(request), ensure_ascii=False))
                return
            actor = User.objects.get(id=options["actor"])
            until = parse_datetime(options["retained_until"])
            if until is None or until.tzinfo is None:
                raise ValueError("Supply a timezone-aware retention expiry.")
            begin_deletion(
                request_id=request.id,
                actor=actor,
                retention_reason=options["retention_reason"],
                retained_until=until,
            )
            erase_personal_data(request_id=request.id, actor=actor)
        except (ValueError, User.DoesNotExist, AccountDeletionRequest.DoesNotExist) as error:
            raise CommandError(str(error)) from error
        self.stdout.write("Completed; preserve this deletion in the external restore manifest.")

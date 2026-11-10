"""Generate evidence-linked Starmo/Starsea draft JSON with Antigravity.

The command never publishes or modifies student/companion records.
Upload the resulting JSON in the existing Content Studio companion import panel.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from django.core.management import BaseCommand, CommandError
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.administration.catalog import Capability
from apps.administration.permissions import has_operational_capability
from apps.content.assistance_import import import_cards
from apps.content.companion_antigravity import (
    CompanionGenerationError,
    generate_companion_import,
)
from apps.content.models import LearningObject, StudyAssistanceIdea
from apps.content.study_assistance_views import AssistanceConflictError


def _private_json_file(path: str, payload: dict[str, Any]) -> None:
    """Exclusive private creation: no replacing older reviewed JSON by accident."""
    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except OSError as exc:
        raise CommandError(f"Cannot create output file: {target}") from exc
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    except OSError as exc:
        target.unlink(missing_ok=True)
        raise CommandError(f"Could not save output file: {target}") from exc


class Command(BaseCommand):
    help = (
        "Use an authenticated Antigravity CLI to generate short Arabic companion "
        "cards from the original PDF and export a draft JSON for manual review/import."
    )

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--sheet-id", required=True, help="LearningObject UUID.")
        parser.add_argument("--actor-email", required=True, help="Authorized content admin.")
        parser.add_argument("--edition", default="university", choices=("university", "lockin"))
        parser.add_argument("--view", default="study", choices=("study", "summary"))
        parser.add_argument("--max-cards", default=40, type=int)
        parser.add_argument("--agy-bin", default="", help="Explicit Antigravity CLI binary.")
        parser.add_argument("--effort", default="low", choices=("low", "medium", "high"))
        parser.add_argument("--timeout", default=180, type=int, help="Seconds per 5-page batch.")
        parser.add_argument(
            "--output", required=True, help="Private JSON import file; must be new."
        )
        parser.add_argument(
            "--import-drafts",
            action="store_true",
            help=(
                "Add generated cards as unpublished drafts using the signed import "
                "preview. Never publishes."
            ),
        )
        parser.add_argument(
            "--report-output",
            default="",
            help="Optional evidence/coverage summary JSON, written with 0600 permissions.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        try:
            sheet_id = UUID(options["sheet_id"])
        except (ValueError, TypeError) as exc:
            raise CommandError("Invalid --sheet-id UUID.") from exc
        actor = User.objects.filter(
            email__iexact=options["actor_email"].strip(), is_active=True
        ).first()
        if actor is None or not has_operational_capability(actor, Capability.CONTENT_MANAGE):
            raise CommandError("An authorized active content administrator is required.")
        sheet = (
            LearningObject.objects.select_related("current_version")
            .filter(id=sheet_id, archived_at__isnull=True)
            .first()
        )
        if sheet is None:
            raise CommandError("The selected sheet was not found or is archived.")
        output_path = Path(options["output"]).expanduser()
        report_path = (
            Path(options["report_output"]).expanduser() if options["report_output"] else None
        )
        if output_path.exists() or (report_path and report_path.exists()):
            raise CommandError("An output file already exists. Choose new file paths.")
        if report_path and output_path.resolve() == report_path.resolve():
            raise CommandError("The JSON and review report must use different files.")
        try:
            payload, report = generate_companion_import(
                sheet=sheet,
                edition=options["edition"],
                view=options["view"],
                max_cards=options["max_cards"],
                agy_bin=options["agy_bin"] or None,
                effort=options["effort"],
                timeout=options["timeout"],
            )
        except CompanionGenerationError as exc:
            raise CommandError(str(exc)) from exc
        _private_json_file(str(output_path), payload)
        if report_path:
            _private_json_file(str(report_path), report)
        self.stdout.write(
            self.style.SUCCESS(
                f"Draft JSON created: {output_path} ({report['cards']} cards, "
                f"{report['pages_with_text']}/{report['physical_page_count']} readable PDF pages)."
            )
        )
        if report["pages_without_text"]:
            self.stderr.write(
                "Warning: scanned/empty pages require separate review: "
                + ", ".join(map(str, report["pages_without_text"]))
            )
        if options["import_drafts"]:
            # Never overwrite or unpublish existing student-visible cards.
            # A direct draft import is only for new cards or existing drafts.
            sheet_payload = payload["sheets"][0]
            generated_ids = [
                uuid5(
                    NAMESPACE_URL,
                    f"lockin:companion:{sheet.id}:"
                    f"{sheet_payload['source_version_id']}:"
                    f"{options['edition']}:{options['view']}:{card['key']}",
                )
                for card in sheet_payload["cards"]
            ]
            if StudyAssistanceIdea.objects.filter(id__in=generated_ids, is_published=True).exists():
                raise CommandError(
                    "Direct draft import would modify published cards. "
                    "Review this JSON manually in Content Studio instead."
                )
            # A generated source is never automatically published. Staff review
            # and a later explicit publication action are still required.
            try:
                preview = import_cards(actor=actor, anchor_id=sheet.id, raw=payload, publish=False)
                result = import_cards(
                    actor=actor,
                    anchor_id=sheet.id,
                    raw=payload,
                    publish=False,
                    token=preview["preview_token"],
                )
            except (ValidationError, AssistanceConflictError) as exc:
                raise CommandError(
                    "Draft import was rejected. Review the JSON and import manually."
                ) from exc
            self.stdout.write(
                self.style.SUCCESS(
                    f"Unpublished drafts imported: {result['imported']} "
                    f"({result['changed_count']} changed). Review and publish in Content Studio."
                )
            )
        else:
            self.stdout.write(
                "No database changes. Open Content Studio > Study companion > "
                "Import companion cards (JSON), preview, review and confirm as draft. "
                "Use --import-drafts to add unpublished cards explicitly."
            )

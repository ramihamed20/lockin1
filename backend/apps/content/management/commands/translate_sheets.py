"""CLI command for sheet translation discovery, extraction, preview, and confirmed save.

Examples:
  # 1) Inspect or extract all Pathology sheets (University edition):
  python manage.py translate_sheets --subject "Pathology" --edition university \\
      --action extract --output pathology_manifest.json

  # 2) Run the General Pathology — Introduction (University) pilot and preview before saving:
  python manage.py translate_sheets --seed-pilot --sheet "General Pathology — Introduction" \\
      --edition university --action preview --output intro_payload.json \\
      --preview-markdown intro_preview.md

  # 3) Save only after reviewing the preview and supplying its signed preview_token:
  python manage.py translate_sheets --action save --input intro_payload.json \\
      --preview-token "<PREVIEW_TOKEN>"
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any
from uuid import UUID

from django.core.management import BaseCommand, CommandError

from apps.accounts.models import User
from apps.content.editions import UNIVERSITY, UnknownEditionError, normalize_edition
from apps.content.services import ContentConflictError, ContentFieldError, ContentRuleError
from apps.content.sheet_translation_batch import (
    apply_translations,
    export_translation_manifest,
    find_sheets_for_translation,
    format_preview_markdown,
    preview_translations,
    translate_manifest_with_gemini,
)
from apps.content.sheet_translation_pilot import (
    PILOT_SHEET_TITLE,
    build_pilot_translation_payload,
    ensure_general_pathology_intro_pilot,
)


class Command(BaseCommand):
    help = (
        "Discover Lock-in sheets by subject/title, extract PDF source text, "
        "preview Arabic translations with medical-term verification, and save after confirmation."
    )

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--action",
            choices=("inspect", "extract", "translate", "preview", "save"),
            default="inspect",
            help=(
                "Operation mode: inspect sheets, extract source manifest, "
                "translate PDF pages with Gemini via Antigravity CLI (agy) and generate preview, "
                "preview translations, or save confirmed translations."
            ),
        )
        parser.add_argument(
            "--translate-with-gemini",
            action="store_true",
            help=(
                "Extract English text from PDF pages and translate automatically to Arabic "
                "using Gemini via Antigravity CLI (Google AI Pro subscription, no paid API key)."
            ),
        )
        parser.add_argument(
            "--agy-bin",
            default="",
            help="Optional explicit path to the Antigravity CLI (agy) binary.",
        )
        parser.add_argument(
            "--effort",
            default="low",
            choices=("low", "medium", "high"),
            help="Gemini reasoning effort passed to Antigravity CLI (default: low).",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=5,
            help="Number of PDF pages translated per Gemini CLI invocation (default: 5).",
        )
        parser.add_argument(
            "--subject",
            default="",
            help=(
                "Subject title or slug filter (for example: 'Pathology' or 'General Pathology')."
            ),
        )
        parser.add_argument(
            "--subject-id",
            default="",
            help="Explicit CatalogSubject or EducationNode UUID.",
        )
        parser.add_argument(
            "--sheet",
            default="",
            help=(
                "Sheet title, slug, or UUID filter "
                "(for example: 'General Pathology — Introduction')."
            ),
        )
        parser.add_argument(
            "--sheet-id",
            default="",
            help="Explicit LearningObject UUID.",
        )
        parser.add_argument(
            "--edition",
            default=UNIVERSITY,
            help="Sheet edition to target: 'university' (default) or 'lockin'.",
        )
        parser.add_argument(
            "--published-only",
            action="store_true",
            help="Restrict discovery to published sheets only.",
        )
        parser.add_argument(
            "--single-format",
            action="store_true",
            help="Emit lockin_translation_v1 when exactly one sheet matches.",
        )
        parser.add_argument(
            "--seed-pilot",
            action="store_true",
            help=(
                "Ensure the 'General Pathology — Introduction' (University) pilot sheet "
                "exists in non-production environments."
            ),
        )
        parser.add_argument(
            "--input",
            default="",
            help="Path to input JSON payload for preview/save (or '-' for stdin).",
        )
        parser.add_argument(
            "--output",
            default="",
            help="Optional path to write the JSON output (manifest, payload, or result).",
        )
        parser.add_argument(
            "--preview-markdown",
            default="",
            help="Optional path to write a human-readable Arabic/English Markdown preview report.",
        )
        parser.add_argument(
            "--preview-token",
            default="",
            help="Signed preview_token returned by --action preview (required for --action save).",
        )
        parser.add_argument(
            "--actor-email",
            default="",
            help="Optional administrator/creator email for audit attribution.",
        )
        parser.add_argument(
            "--allow-production",
            action="store_true",
            help=(
                "Explicitly authorize saving in a production environment "
                "after preview confirmation."
            ),
        )

    def _resolve_actor(self, email: str) -> User | None:
        cleaned = email.strip()
        if not cleaned:
            return None
        actor = User.objects.filter(email__iexact=cleaned, is_active=True).first()
        if actor is None:
            raise CommandError(f"No active user found with email '{cleaned}'.")
        return actor

    def _parse_uuid(self, value: str, flag_name: str) -> UUID | None:
        cleaned = value.strip()
        if not cleaned:
            return None
        try:
            return UUID(cleaned)
        except ValueError as error:
            raise CommandError(f"Invalid UUID for {flag_name}: {cleaned}") from error

    def _load_input_json(self, input_path: str) -> dict[str, Any]:
        cleaned = input_path.strip()
        if not cleaned:
            raise CommandError(
                "--input is required unless running --seed-pilot with --action preview."
            )
        try:
            raw_text = (
                sys.stdin.read() if cleaned == "-" else Path(cleaned).read_text(encoding="utf-8")
            )
            data = json.loads(raw_text)
        except OSError as error:
            raise CommandError(f"Could not read input file '{cleaned}': {error}") from error
        except json.JSONDecodeError as error:
            raise CommandError(f"Input file '{cleaned}' is not valid JSON: {error}") from error
        if not isinstance(data, dict):
            raise CommandError("Input JSON root must be an object.")
        return data

    def _write_json(self, payload: dict[str, Any], output_path: str) -> None:
        rendered = json.dumps(payload, ensure_ascii=False, indent=2)
        if output_path.strip():
            target = Path(output_path.strip())
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(rendered + "\n", encoding="utf-8")
        self.stdout.write(rendered)

    def handle(self, *args: Any, **options: Any) -> None:
        del args
        try:
            edition = normalize_edition(options["edition"])
        except UnknownEditionError as error:
            raise CommandError(str(error)) from error

        actor = self._resolve_actor(options["actor_email"])
        subject_id = self._parse_uuid(options["subject_id"], "--subject-id")
        sheet_id = self._parse_uuid(options["sheet_id"], "--sheet-id")
        action = str(options["action"])

        try:
            pilot_sheet = None
            if options["seed_pilot"]:
                pilot_sheet = ensure_general_pathology_intro_pilot(actor=actor)

            if action in {"inspect", "extract"}:
                default_sheet_query = (
                    PILOT_SHEET_TITLE if pilot_sheet is not None and not options["subject"] else ""
                )
                sheets = find_sheets_for_translation(
                    subject_query=options["subject"],
                    sheet_query=options["sheet"] or default_sheet_query,
                    sheet_id=sheet_id,
                    subject_id=subject_id,
                    published_only=bool(options["published_only"]),
                )
                manifest = export_translation_manifest(
                    sheets=sheets,
                    edition=edition,
                    extract_pdf_source=(action == "extract"),
                    single_sheet_format=bool(options["single_format"]),
                )
                self._write_json(manifest, options["output"])
                return

            if action == "translate" or (
                action == "preview" and bool(options["translate_with_gemini"])
            ):
                default_sheet_query = (
                    PILOT_SHEET_TITLE if pilot_sheet is not None and not options["subject"] else ""
                )
                sheets = find_sheets_for_translation(
                    subject_query=options["subject"],
                    sheet_query=options["sheet"] or default_sheet_query,
                    sheet_id=sheet_id,
                    subject_id=subject_id,
                    published_only=bool(options["published_only"]),
                )
                if not sheets:
                    raise CommandError("No matching sheets found for Gemini translation.")
                manifest = export_translation_manifest(
                    sheets=sheets,
                    edition=edition,
                    extract_pdf_source=True,
                    single_sheet_format=bool(options["single_format"]) or len(sheets) == 1,
                )
                raw_payload = translate_manifest_with_gemini(
                    manifest,
                    agy_bin=options["agy_bin"].strip() or None,
                    effort=str(options["effort"]),
                    batch_size=int(options["batch_size"]),
                )
                preview = preview_translations(
                    raw=raw_payload,
                    actor=actor,
                    default_sheet_id=sheet_id,
                    default_edition=edition,
                )
                if options["preview_markdown"].strip():
                    md_path = Path(options["preview_markdown"].strip())
                    md_path.parent.mkdir(parents=True, exist_ok=True)
                    md_path.write_text(format_preview_markdown(preview), encoding="utf-8")

                if options["output"].strip():
                    out_path = Path(options["output"].strip())
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    out_path.write_text(
                        json.dumps(
                            {
                                **raw_payload,
                                "preview_token": preview["preview_token"],
                                "preview": preview,
                            },
                            ensure_ascii=False,
                            indent=2,
                        )
                        + "\n",
                        encoding="utf-8",
                    )
                    self.stdout.write(json.dumps(preview, ensure_ascii=False, indent=2))
                    return

                self._write_json(preview, "")
                return

            if action == "preview":
                if options["input"].strip():
                    raw_payload = self._load_input_json(options["input"])
                elif pilot_sheet is not None:
                    raw_payload = build_pilot_translation_payload(pilot_sheet, edition=edition)
                else:
                    sheets = find_sheets_for_translation(
                        subject_query=options["subject"],
                        sheet_query=options["sheet"] or PILOT_SHEET_TITLE,
                        sheet_id=sheet_id,
                        subject_id=subject_id,
                        published_only=bool(options["published_only"]),
                    )
                    first_title = (
                        sheets[0].current_version.title
                        if len(sheets) == 1 and sheets[0].current_version
                        else ""
                    )
                    if len(sheets) == 1 and PILOT_SHEET_TITLE.lower() in first_title.lower():
                        raw_payload = build_pilot_translation_payload(sheets[0], edition=edition)
                    else:
                        raise CommandError(
                            "Provide --input <translations.json> for --action preview "
                            "(or use --seed-pilot for the General Pathology — Introduction pilot)."
                        )

                preview = preview_translations(
                    raw=raw_payload,
                    actor=actor,
                    default_sheet_id=sheet_id,
                    default_edition=edition,
                )
                if options["preview_markdown"].strip():
                    md_path = Path(options["preview_markdown"].strip())
                    md_path.parent.mkdir(parents=True, exist_ok=True)
                    md_path.write_text(format_preview_markdown(preview), encoding="utf-8")

                if options["output"].strip() and not options["input"].strip():
                    out_path = Path(options["output"].strip())
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    out_path.write_text(
                        json.dumps(
                            {
                                **raw_payload,
                                "preview_token": preview["preview_token"],
                                "preview": preview,
                            },
                            ensure_ascii=False,
                            indent=2,
                        )
                        + "\n",
                        encoding="utf-8",
                    )
                    self.stdout.write(json.dumps(preview, ensure_ascii=False, indent=2))
                    return

                self._write_json(preview, options["output"])
                return

            if action == "save":
                raw_payload = self._load_input_json(options["input"])
                token = str(
                    options["preview_token"] or raw_payload.get("preview_token") or ""
                ).strip()
                if not token:
                    raise CommandError(
                        "--preview-token is required for --action save. Run --action preview first."
                    )
                saved = apply_translations(
                    raw=raw_payload,
                    preview_token=token,
                    actor=actor,
                    default_sheet_id=sheet_id,
                    default_edition=edition,
                    allow_production=bool(options["allow_production"]),
                )
                self._write_json(saved, options["output"])
                return

        except (ContentConflictError, ContentRuleError) as error:
            raise CommandError(str(error)) from error
        except ContentFieldError as error:
            raise CommandError(json.dumps(error.fields, ensure_ascii=False)) from error

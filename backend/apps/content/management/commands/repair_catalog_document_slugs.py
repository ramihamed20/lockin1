import json
from typing import Any

from django.core.management import BaseCommand
from django.db import transaction

from apps.content.admin_services import _subject_for_node, _sync_catalog_document
from apps.content.models import CatalogDocument, CatalogSubject


class Command(BaseCommand):
    help = "Report or repair stale Catalog material slugs without changing sheet slugs."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args: Any, **options: Any) -> None:
        del args
        if options["apply"] and options["dry_run"]:
            raise ValueError("Choose either --apply or --dry-run, not both.")
        documents = CatalogDocument.objects.select_related(
            "version__academic_node",
            "version__learning_object__published_version",
        ).order_by("created_at", "id")
        report: list[dict[str, object]] = []
        repaired = 0
        for document in documents.iterator():
            subject_node = _subject_for_node(document.version.academic_node)
            subject = CatalogSubject.objects.filter(
                source_node=subject_node,
                is_active=True,
            ).first()
            expected = subject.material_slug if subject else None
            if expected == document.material_slug:
                continue
            item: dict[str, object] = {
                "document_id": str(document.id),
                "sheet_id": str(document.version.learning_object_id),
                "sheet_slug": document.sheet_slug,
                "old_material_slug": document.material_slug,
                "expected_material_slug": expected,
                "state": "unmapped" if expected is None else "stale",
            }
            learning_object = document.version.learning_object
            if options["apply"] and expected is not None:
                with transaction.atomic():
                    _sync_catalog_document(learning_object)
                document.refresh_from_db()
                if document.sheet_slug != item["sheet_slug"]:
                    raise RuntimeError("Catalog repair attempted to change an existing sheet slug.")
                item["state"] = "repaired"
                repaired += 1
            report.append(item)
        self.stdout.write(
            json.dumps(
                {
                    "mode": "apply" if options["apply"] else "dry-run",
                    "affected": len(report),
                    "repaired": repaired,
                    "documents": report,
                },
                sort_keys=True,
            )
        )

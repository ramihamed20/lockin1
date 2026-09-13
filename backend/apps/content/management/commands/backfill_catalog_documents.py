import json
from typing import Any

from django.core.management import BaseCommand
from django.db import transaction

from apps.content.admin_services import (
    _catalog_subject_for_node,
    _subject_for_node,
    _sync_catalog_document,
)
from apps.content.models import CatalogDocument, CatalogSubject, LearningObject


class Command(BaseCommand):
    help = "Report or create missing CatalogDocument projections for published PDF sheets."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args: Any, **options: Any) -> None:
        del args
        if options["apply"] and options["dry_run"]:
            raise ValueError("Choose either --apply or --dry-run, not both.")
        sheets = (
            LearningObject.objects.filter(
                archived_at__isnull=True,
                published_version__content_type="pdf",
            )
            .select_related("published_version__academic_node")
            .order_by("created_at", "id")
        )
        report: list[dict[str, object]] = []
        created_or_updated = 0
        for sheet in sheets.iterator():
            version = sheet.published_version
            if version is None:
                continue
            subject_node = _subject_for_node(version.academic_node)
            mapped = CatalogSubject.objects.filter(
                source_node=subject_node,
                is_active=True,
            ).first()
            existing = CatalogDocument.objects.filter(
                version__learning_object=sheet,
            ).first()
            state = (
                "current"
                if existing
                and existing.version_id == version.id
                and existing.is_active
                and mapped is not None
                and existing.material_slug == mapped.material_slug
                else "missing"
            )
            if mapped is None:
                state = "unmapped"
            item: dict[str, object] = {
                "sheet_id": str(sheet.id),
                "title": version.title,
                "state": state,
                "subject_node_id": str(subject_node.id),
                "catalog_document_id": str(existing.id) if existing else None,
            }
            if options["apply"] and mapped is not None and state != "current":
                with transaction.atomic():
                    # Re-evaluate through the canonical projection path while
                    # holding this sheet's update in one transaction.
                    _catalog_subject_for_node(version.academic_node)
                    if _sync_catalog_document(sheet):
                        created_or_updated += 1
                        item["state"] = "repaired"
            report.append(item)
        self.stdout.write(
            json.dumps(
                {
                    "mode": "apply" if options["apply"] else "dry-run",
                    "examined": len(report),
                    "repaired": created_or_updated,
                    "sheets": report,
                },
                sort_keys=True,
            )
        )

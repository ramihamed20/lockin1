import json
from typing import Any

from django.core.management import BaseCommand
from django.db import transaction

from apps.content.models import LearningObjectAsset, LearningObjectVersion
from apps.files.models import ManagedFile
from apps.files.services import inspect_managed_pdf


class Command(BaseCommand):
    help = "Report or backfill authoritative PDF page counts and stored-size mismatches."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args: Any, **options: Any) -> None:
        del args
        if options["apply"] and options["dry_run"]:
            raise ValueError("Choose either --apply or --dry-run, not both.")
        rows: list[dict[str, object]] = []
        repaired = 0
        size_mismatches = 0
        files = ManagedFile.objects.filter(kind=ManagedFile.Kind.PDF).order_by("created_at", "id")
        for managed_file in files.iterator():
            inspection = inspect_managed_pdf(managed_file)
            mismatch = (
                inspection.stored_size is not None
                and inspection.stored_size != managed_file.size_bytes
            )
            size_mismatches += int(mismatch)
            item: dict[str, object] = {
                "file_id": str(managed_file.id),
                "database_size": managed_file.size_bytes,
                "stored_size": inspection.stored_size,
                "size_mismatch": mismatch,
                "old_page_count": managed_file.pdf_page_count,
                "derived_page_count": inspection.page_count,
                "state": inspection.error
                or (
                    "current"
                    if managed_file.pdf_page_count == inspection.page_count
                    else "page_count_mismatch"
                ),
            }
            if options["apply"] and inspection.page_count is not None:
                with transaction.atomic():
                    changed_file = managed_file.pdf_page_count != inspection.page_count
                    if changed_file:
                        managed_file.pdf_page_count = inspection.page_count
                        managed_file.save(update_fields=("pdf_page_count",))
                    version_ids = LearningObjectAsset.objects.filter(
                        managed_file=managed_file,
                        role=LearningObjectAsset.Role.PRIMARY,
                        version__content_type=LearningObjectVersion.ContentType.PDF,
                    ).values_list("version_id", flat=True)
                    changed_versions = (
                        LearningObjectVersion.objects.filter(id__in=version_ids)
                        .exclude(page_count=inspection.page_count)
                        .update(page_count=inspection.page_count)
                    )
                    if changed_file or changed_versions:
                        repaired += 1
                        item["state"] = "repaired"
            rows.append(item)
        self.stdout.write(
            json.dumps(
                {
                    "mode": "apply" if options["apply"] else "dry-run",
                    "examined": len(rows),
                    "repaired": repaired,
                    "size_mismatches": size_mismatches,
                    "files": rows,
                },
                sort_keys=True,
            )
        )

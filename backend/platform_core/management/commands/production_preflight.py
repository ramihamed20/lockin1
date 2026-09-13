import json
import socket
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management import BaseCommand, CommandError, call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from apps.content.catalog_subjects import cohorts_without_branches
from apps.files.models import ManagedFile
from apps.payments.models import TelegramPaymentOperator
from platform_core.production.database import (
    DatabaseReleaseError,
    collect_database_evidence,
    evidence_as_dict,
)


def scanner_is_reachable() -> bool:
    host = str(settings.FILE_SCAN_HOST).strip()
    port = int(settings.FILE_SCAN_PORT)
    timeout = max(0.1, min(float(settings.FILE_SCAN_CONNECT_TIMEOUT_SECONDS), 5.0))
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


class Command(BaseCommand):
    help = "Fail closed unless the running production image/database pass launch preflight."

    def handle(self, *args: Any, **options: Any) -> None:
        del args, options
        if getattr(settings, "ENVIRONMENT", "") != "production":
            raise CommandError("Production preflight requires production settings.")
        call_command("check", deploy=True, fail_level="ERROR")
        try:
            database = collect_database_evidence(connection=connection)
        except DatabaseReleaseError as error:
            raise CommandError(str(error)) from error
        if database.server_version < 160_000:
            raise CommandError("PostgreSQL 16 or newer is required.")
        if database.elevated_role or database.schema_create:
            raise CommandError("The runtime database role has elevated schema/database privileges.")
        if database.audit_mutation:
            raise CommandError("The runtime database role can mutate append-only audit records.")

        executor = MigrationExecutor(connection)
        unapplied = executor.migration_plan(executor.loader.graph.leaf_nodes())
        if unapplied:
            raise CommandError(f"There are {len(unapplied)} unapplied migration operations.")
        # Scan evidence is only meaningful where the deployment enforces it.
        # When enforcement is off the count is not collected, and the evidence
        # below records that the deployment stated the decision.
        clean_scan_enforced = bool(settings.CONTENT_REQUIRE_CLEAN_SCAN)
        unsafe_files = 0
        if clean_scan_enforced:
            if not scanner_is_reachable():
                raise CommandError(
                    "CONTENT_REQUIRE_CLEAN_SCAN is enabled but the scanner is unreachable. "
                    "Start the file-scanning profile or explicitly disable clean-scan enforcement."
                )
            unsafe_files = (
                ManagedFile.objects.exclude(scan_status=ManagedFile.ScanStatus.CLEAN)
                # The exact published-version relation is authoritative even while
                # a newer current version is in draft/review.
                .filter(learning_object_assets__version__published_for__archived_at__isnull=True)
                .distinct()
                .count()
            )
            if unsafe_files:
                raise CommandError(
                    f"There are {unsafe_files} published files without clean scan evidence."
                )
        static_root = Path(settings.STATIC_ROOT)
        if not static_root.is_dir() or not any(static_root.iterdir()):
            raise CommandError("Collected static assets are missing.")

        # Two configuration gaps that a green deploy used to hide. Neither can
        # fail a release -- a deployment may legitimately run without Telegram,
        # and a cohort may be configured after launch -- but both produce a
        # feature that looks healthy and serves nobody, so the release states
        # them rather than leaving them to be discovered in production.
        telegram_operators = 0
        if str(getattr(settings, "TELEGRAM_WEBHOOK_SECRET_TOKEN", "")).strip():
            telegram_operators = TelegramPaymentOperator.objects.filter(is_active=True).count()
            if not telegram_operators:
                self.stderr.write(
                    "WARNING: the Telegram payment webhook is configured but no operator is "
                    "linked. Every Approve/Reject button will be refused. Link one with "
                    "`manage.py telegram_operator --link <id> --user <email>`."
                )
        empty_cohorts = [
            f"{cohort.program.code}/{cohort.code}" for cohort in cohorts_without_branches()
        ]
        if empty_cohorts:
            self.stderr.write(
                "WARNING: these active cohorts expose no Catalog subjects, so their students "
                f"see an empty Materials page: {', '.join(empty_cohorts)}. Attach a content "
                "root and run `manage.py sync_catalog_subjects`."
            )

        evidence = {
            "status": "ready",
            "environment": settings.ENVIRONMENT,
            "database": evidence_as_dict(database),
            "unapplied_migrations": 0,
            "clean_scan_enforced": clean_scan_enforced,
            "scanner_reachable": clean_scan_enforced,
            "unsafe_published_files": unsafe_files,
            "static_assets": "present",
            "telegram_payment_operators": telegram_operators,
            "cohorts_without_catalog_subjects": empty_cohorts,
        }
        self.stdout.write(json.dumps(evidence, sort_keys=True))

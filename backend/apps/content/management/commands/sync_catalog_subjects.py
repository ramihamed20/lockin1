"""Bring every cohort's Catalog branches in step with the education hierarchy.

The signals in ``apps.content.signals`` keep this current from here on. This
command is the operator's equivalent: a way to reconcile a database that
predates them, to see what a change would do before making it, and to name the
cohorts that expose nothing at all.

It creates and renames branches. It never deactivates one and never moves one
between cohorts, for the reason given in ``apps.content.catalog_subjects``.
"""

from typing import Any

from django.core.management.base import BaseCommand, CommandParser
from django.db import transaction

from apps.content.catalog_subjects import (
    ProjectionResult,
    cohorts_without_branches,
    project_all,
)
from apps.education.models import StudentCohort


class Command(BaseCommand):
    help = "Project education subjects into the Catalog branches students read."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change and roll it back.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        del args
        dry_run = bool(options["dry_run"])
        result = ProjectionResult()
        orphans: list[StudentCohort] = []
        try:
            with transaction.atomic():
                result = project_all()
                orphans = cohorts_without_branches()
                if dry_run:
                    # The projection has to actually run to be reported, so the
                    # only honest dry run is one that rolls itself back.
                    raise _Rollback
        except _Rollback:
            pass

        for material_slug in result.created:
            self.stdout.write(self.style.SUCCESS(f"created  {material_slug}"))
        for material_slug in result.updated:
            self.stdout.write(f"updated  {material_slug}")
        for slug in result.unowned:
            self.stdout.write(f"skipped  {slug} (under no cohort content root)")
        for slug in result.conflicted:
            self.stdout.write(self.style.WARNING(f"conflict {slug} (already owned elsewhere)"))

        if orphans:
            self.stdout.write("")
            self.stdout.write(
                self.style.WARNING(
                    "These active cohorts expose no Catalog subjects. Students enrolled in "
                    "them see an empty Materials page until a content root is attached:"
                )
            )
            for cohort in orphans:
                self.stdout.write(
                    self.style.WARNING(f"  {cohort.program.code}/{cohort.code} — {cohort.name_en}")
                )

        summary = (
            f"{len(result.created)} created, {len(result.updated)} updated, "
            f"{len(result.unowned)} unowned, {len(result.conflicted)} conflicted"
        )
        self.stdout.write("")
        self.stdout.write(
            self.style.WARNING(f"Dry run — nothing was written. {summary}.")
            if dry_run
            else self.style.SUCCESS(summary + ".")
        )


class _Rollback(Exception):
    """Aborts the dry run's transaction without reporting a failure."""

import contextlib
from collections.abc import Iterator
from typing import Any

from django.conf import settings
from django.core.management import BaseCommand, CommandError, call_command
from django.db import connection

from platform_core.production.database import DatabaseReleaseError, apply_runtime_grants

# An arbitrary but fixed key, so every replica of every version contends for the
# same lock. Advisory locks are namespaced per database, which is the scope we
# want: one release at a time against one database.
RELEASE_ADVISORY_LOCK_KEY = 8_073_224_190_411_001


@contextlib.contextmanager
def release_lock() -> Iterator[bool]:
    """Serialise the release step across every instance sharing this database.

    The container-host entry point defaults `LOCKIN_RUN_RELEASE=true` for the web
    role, so scaling to more than one web replica used to start that many
    concurrent `migrate` runs against one database. Concurrent migrations are not
    safe: they race on the migration table and can deadlock on DDL.

    A blocking advisory lock makes the second replica wait rather than race, and
    when it acquires the lock the work is already done -- `migrate` then finds
    nothing pending and is a no-op. The wait is deliberate: a replica must not
    begin serving against a schema that is still being migrated.

    The lock is released when the block exits, and by PostgreSQL itself if the
    connection dies, so a crashed release cannot wedge the next deploy.
    """

    if connection.vendor != "postgresql":
        yield False
        return
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", [RELEASE_ADVISORY_LOCK_KEY])
        row = cursor.fetchone()
        acquired_immediately = bool(row and row[0])
        if not acquired_immediately:
            # Another instance holds it. Block until it finishes.
            cursor.execute("SELECT pg_advisory_lock(%s)", [RELEASE_ADVISORY_LOCK_KEY])
    try:
        yield acquired_immediately
    finally:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_unlock(%s)", [RELEASE_ADVISORY_LOCK_KEY])


class Command(BaseCommand):
    help = "Run the explicit production migration/static release step and runtime-role grants."

    def handle(self, *args: Any, **options: Any) -> None:
        del args, options
        if getattr(settings, "ENVIRONMENT", "") != "production":
            raise CommandError("The release command requires production settings.")
        runtime_role = str(getattr(settings, "DATABASE_RUNTIME_ROLE", ""))
        migration_role = str(settings.DATABASES["default"]["USER"])
        if migration_role == runtime_role:
            raise CommandError("The migration owner and runtime PostgreSQL role must differ.")
        call_command("check", deploy=True, fail_level="ERROR")
        with release_lock() as acquired_immediately:
            if not acquired_immediately:
                self.stdout.write("Waited for another instance to finish its release step.")
            call_command("migrate", interactive=False)
            # Static assets are per-container, so they are collected whether or
            # not this instance owned the migration.
            call_command("collectstatic", interactive=False, verbosity=0)
            try:
                apply_runtime_grants(
                    connection=connection,
                    runtime_role=runtime_role,
                )
            except DatabaseReleaseError as error:
                raise CommandError(str(error)) from error
        self.stdout.write(self.style.SUCCESS("Production release step completed."))

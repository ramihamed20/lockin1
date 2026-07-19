from typing import Any

from django.conf import settings
from django.core.management import BaseCommand, CommandError, call_command
from django.db import connection

from platform_core.production.database import DatabaseReleaseError, apply_runtime_grants


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
        call_command("migrate", interactive=False)
        call_command("collectstatic", interactive=False, verbosity=0)
        try:
            apply_runtime_grants(
                connection=connection,
                runtime_role=runtime_role,
            )
        except DatabaseReleaseError as error:
            raise CommandError(str(error)) from error
        self.stdout.write(self.style.SUCCESS("Production release step completed."))

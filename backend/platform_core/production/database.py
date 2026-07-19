import re
from dataclasses import dataclass
from typing import Any

from django.db.backends.base.base import BaseDatabaseWrapper

ROLE_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,62}\Z")


class DatabaseReleaseError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class DatabaseEvidence:
    vendor: str
    server_version: int
    current_role: str
    elevated_role: bool
    schema_create: bool
    audit_mutation: bool


def validate_role_name(role: str) -> str:
    if not ROLE_PATTERN.fullmatch(role):
        raise DatabaseReleaseError("POSTGRES_RUNTIME_ROLE is not a valid PostgreSQL role name.")
    return role


def apply_runtime_grants(*, connection: BaseDatabaseWrapper, runtime_role: str) -> None:
    """Apply least-privilege runtime grants while connected as the migration owner."""

    if connection.vendor != "postgresql":
        raise DatabaseReleaseError("Runtime database grants require PostgreSQL.")
    role = connection.ops.quote_name(validate_role_name(runtime_role))
    database = connection.ops.quote_name(str(connection.settings_dict["NAME"]))
    with connection.cursor() as cursor:
        cursor.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        cursor.execute(f"GRANT CONNECT ON DATABASE {database} TO {role}")
        cursor.execute(f"REVOKE CREATE ON SCHEMA public FROM {role}")
        cursor.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
        cursor.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}"
        )
        cursor.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role}")
        cursor.execute(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {role}"
        )
        cursor.execute(
            f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {role}"
        )
        cursor.execute("SELECT to_regclass('public.audit_auditrecord')")
        if cursor.fetchone()[0] is not None:
            cursor.execute(
                f"REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_auditrecord FROM {role}"
            )


def collect_database_evidence(*, connection: BaseDatabaseWrapper) -> DatabaseEvidence:
    if connection.vendor != "postgresql":
        raise DatabaseReleaseError("Production preflight requires PostgreSQL.")
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT current_user,
                   current_setting('server_version_num')::integer,
                   rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
            FROM pg_roles
            WHERE rolname = current_user
            """
        )
        row = cursor.fetchone()
        if row is None:
            raise DatabaseReleaseError("Could not inspect the current PostgreSQL role.")
        cursor.execute("SELECT has_schema_privilege(current_user, 'public', 'CREATE')")
        schema_create = bool(cursor.fetchone()[0])
        cursor.execute("SELECT to_regclass('public.audit_auditrecord')")
        audit_table_exists = cursor.fetchone()[0] is not None
        audit_mutation = False
        if audit_table_exists:
            cursor.execute(
                "SELECT has_table_privilege(current_user, 'audit_auditrecord', "
                "'UPDATE, DELETE, TRUNCATE')"
            )
            audit_mutation = bool(cursor.fetchone()[0])
    return DatabaseEvidence(
        vendor=connection.vendor,
        server_version=int(row[1]),
        current_role=str(row[0]),
        elevated_role=bool(row[2]),
        schema_create=schema_create,
        audit_mutation=audit_mutation,
    )


def evidence_as_dict(evidence: DatabaseEvidence) -> dict[str, Any]:
    return {
        "vendor": evidence.vendor,
        "server_version": evidence.server_version,
        "current_role": evidence.current_role,
        "elevated_role": evidence.elevated_role,
        "schema_create": evidence.schema_create,
        "audit_mutation": evidence.audit_mutation,
    }

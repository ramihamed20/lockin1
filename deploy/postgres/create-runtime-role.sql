-- Create the least-privilege runtime role on a managed PostgreSQL provider
-- (Supabase, Neon, RDS, or any other), where the bundled container init script
-- deploy/postgres/init-runtime-role.sh cannot run.
--
-- The application never migrates and serves with the same role: the release
-- step connects as the owner, and every serving process connects as the role
-- created here. Production preflight fails closed if the serving role turns out
-- to hold schema or superuser privileges.
--
-- Run it once, as the database owner, against the application database:
--
--   psql "$OWNER_DATABASE_URL" \
--     --set ON_ERROR_STOP=1 \
--     --set runtime_role=lockin_app \
--     --set runtime_password="$RUNTIME_PASSWORD" \
--     --file deploy/postgres/create-runtime-role.sql
--
-- Table and sequence grants are applied by `manage.py release` on every deploy,
-- so this script only establishes the role and its schema-level access.

\set ON_ERROR_STOP on

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    :'runtime_role',
    :'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role')
\gexec

-- Rotating the password is the same script with a new value.
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'runtime_role', :'runtime_password')
\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', :'runtime_role')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'runtime_role')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_role')
\gexec

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;

-- Confirm the result before deploying: both columns must report false.
SELECT rolname,
       rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
           AS elevated_role,
       has_schema_privilege(rolname, 'public', 'CREATE') AS schema_create
FROM pg_roles
WHERE rolname = :'runtime_role';

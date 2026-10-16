"""Bounded loopback HTTP/SQL/stream lab with real synthetic sessions and PostgreSQL.

Requires the isolated Lock-in performance cluster on port 55441. Creates and
removes only its own named test database. No production URL/cookies/data.
"""

from __future__ import annotations

import argparse
import cProfile
import hashlib
import http.client
import json
import math
import os
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings.test"
os.environ["STORAGE_BACKEND"] = "filesystem"


def percentiles(values):
    ordered = sorted(values)
    return {
        f"p{int(q * 100)}": round(ordered[max(0, math.ceil(len(ordered) * q) - 1)], 2)
        for q in (0.5, 0.75, 0.95)
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--requests", type=int, default=48)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--catalog-sheets", type=int, choices=(18, 180), default=18)
    parser.add_argument("--query-plans", action="store_true")
    parser.add_argument("--profile-catalog", action="store_true")
    parser.add_argument(
        "--pdf-fixture", choices=("medium", "scanned"), default="medium"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO / "frontend/output/performance/backend-http.json",
    )
    args = parser.parse_args()
    if not 16 <= args.requests <= 200 or not 1 <= args.concurrency <= 4:
        parser.error("requests must be 16..200; concurrency must be 1..4")

    import django

    django.setup()
    from apps.accounts.tests.helpers import PASSWORD, create_user
    from apps.content.admin_services import create_sheet
    from apps.content.models import CatalogSubject
    from apps.education.models import AcademicProgram, StudentCohort
    from apps.education.tests.helpers import create_admin, published_path
    from apps.files.services import create_managed_file
    from django.core.files.uploadedfile import SimpleUploadedFile
    from django.core.servers.basehttp import ThreadedWSGIServer, WSGIRequestHandler
    from django.core.wsgi import get_wsgi_application
    from django.db import connection, connections, transaction
    from django.test import Client, override_settings
    from django.test.utils import (
        CaptureQueriesContext,
        setup_databases,
        teardown_databases,
    )

    config = connections.databases["default"]
    if (
        config["ENGINE"],
        config["HOST"],
        str(config["PORT"]),
        config["NAME"],
        config["USER"],
    ) != (
        "django.db.backends.postgresql",
        "127.0.0.1",
        "55441",
        "lockin_performance",
        "lockin_perf",
    ):
        raise SystemExit(
            "Refusing a database outside the dedicated synthetic loopback cluster"
        )
    nonce = uuid.uuid4().hex[:10]
    database = "test_lockin_performance_http_" + nonce
    config["TEST"]["NAME"] = database
    records, sql_records = [], {}
    catalog_queries, catalog_profiles = [], []
    sql_lock = threading.Lock()
    old_config = None
    with tempfile.TemporaryDirectory(prefix="lockin-performance-http-") as media:
        media_path = Path(media).resolve()
        if media_path.parent != Path(
            tempfile.gettempdir()
        ).resolve() or not media_path.name.startswith("lockin-performance-http-"):
            raise SystemExit("Unexpected synthetic media directory")
        with override_settings(
            MEDIA_ROOT=media_path,
            ALLOWED_HOSTS=["localhost", "127.0.0.1", "testserver"],
        ):
            try:
                old_config = setup_databases(verbosity=0, interactive=False)
                if connection.settings_dict["NAME"] != database:
                    raise RuntimeError("Unexpected test database")
                admin = create_admin(email=f"perf-admin-{nonce}@example.test")
                _, subject, _ = published_path(admin=admin)
                program = AcademicProgram.objects.create(
                    code="perf-" + nonce, name_en="Synthetic", name_ar="Synthetic"
                )
                cohort = StudentCohort.objects.create(
                    program=program,
                    code="lab",
                    name_en="Synthetic cohort",
                    name_ar="Synthetic cohort",
                )
                cohort.content_nodes.add(subject)
                branch = CatalogSubject.objects.get(source_node=subject)
                if branch.cohort_id != cohort.id:
                    raise RuntimeError(
                        "Synthetic subject was projected into another cohort"
                    )
                fixture_name = (
                    "sheet-scanned.pdf"
                    if args.pdf_fixture == "scanned"
                    else "sheet-range.pdf"
                )
                file_bytes = (
                    REPO / "frontend/e2e/fixtures/pdf" / fixture_name
                ).read_bytes()
                if (
                    not file_bytes.startswith(b"%PDF-")
                    or not 1024 <= len(file_bytes) <= 16 * 1024 * 1024
                ):
                    raise RuntimeError(
                        "Regenerate the known bounded synthetic PDF fixture"
                    )
                for index in range(args.catalog_sheets):
                    managed = create_managed_file(
                        owner=admin,
                        upload=SimpleUploadedFile(
                            f"synthetic-{index}.pdf",
                            file_bytes,
                            content_type="application/pdf",
                        ),
                        kind="pdf",
                    )
                    create_sheet(
                        actor=admin,
                        subject=subject,
                        managed_file=managed,
                        title=f"Synthetic sheet {index}",
                        summary="Local lab only",
                        position=index,
                        publish=True,
                        notify_students=False,
                        allow_download=True,
                    )
                sessions = []
                for index in range(4):
                    student = create_user(
                        email=f"perf-{nonce}-{index}@example.test",
                        full_name="Synthetic Student",
                        cohort=cohort,
                        with_trial=True,
                    )
                    client = Client(enforce_csrf_checks=True)
                    csrf = client.get(
                        "/api/v1/auth/csrf",
                        HTTP_USER_AGENT="Lockin synthetic performance lab",
                    ).json()["csrf_token"]
                    signed_in = client.post(
                        "/api/v1/auth/login",
                        data=json.dumps({"email": student.email, "password": PASSWORD}),
                        content_type="application/json",
                        HTTP_X_CSRFTOKEN=csrf,
                        HTTP_USER_AGENT="Lockin synthetic performance lab",
                    )
                    if signed_in.status_code != 200:
                        raise RuntimeError(
                            f"Synthetic login returned {signed_in.status_code}"
                        )
                    directory = client.get(
                        "/api/v1/catalog/materials",
                        HTTP_USER_AGENT="Lockin synthetic performance lab",
                    )
                    if (
                        directory.status_code != 200
                        or sum(
                            len(branch["sheets"])
                            for branch in directory.json()["results"]
                        )
                        != args.catalog_sheets
                    ):
                        raise RuntimeError(
                            f"Synthetic catalog did not expose all {args.catalog_sheets} published sheets"
                        )
                    sessions.append(
                        "; ".join(
                            f"{key}={value.value}"
                            for key, value in client.cookies.items()
                        )
                    )

                if args.query_plans:
                    # Fresh fixture tables need representative statistics before
                    # interpreting plans; only the already validated owned DB.
                    with connection.cursor() as cursor:
                        cursor.execute("ANALYZE")
                django_app = get_wsgi_application()

                def measured_app(environ, start_response):
                    response = None
                    profile = None
                    profile_index = None
                    if (
                        args.profile_catalog
                        and environ.get("PATH_INFO") == "/api/v1/catalog/materials"
                    ):
                        with sql_lock:
                            if len(catalog_profiles) < 3:
                                profile_index = len(catalog_profiles)
                                catalog_profiles.append(None)
                                profile = cProfile.Profile()
                    sample_id = environ.get("HTTP_X_LOCKIN_PERF_ID", "")
                    try:
                        if profile is not None:
                            profile.enable()
                        with CaptureQueriesContext(connection) as queries:
                            response = django_app(environ, start_response)
                            yield from response
                        with sql_lock:
                            if (
                                args.query_plans
                                and environ.get("PATH_INFO")
                                == "/api/v1/catalog/materials"
                                and not catalog_queries
                            ):
                                catalog_queries.extend(
                                    query["sql"]
                                    for query in queries
                                    if query["sql"]
                                    .lstrip()
                                    .upper()
                                    .startswith("SELECT ")
                                )
                            sql_records[sample_id] = {
                                "queries": len(queries),
                                "databaseMs": round(
                                    sum(
                                        float(query["time"]) * 1000 for query in queries
                                    ),
                                    2,
                                ),
                            }
                    finally:
                        if profile is not None:
                            profile.disable()
                            functions = []
                            for entry in profile.getstats():
                                code = entry.code
                                filename = getattr(code, "co_filename", "")
                                path = Path(filename)
                                functions.append(
                                    {
                                        "function": getattr(code, "co_name", str(code)),
                                        "file": str(path.relative_to(REPO))
                                        if path.is_relative_to(REPO)
                                        else path.name,
                                        "line": getattr(code, "co_firstlineno", 0),
                                        "calls": entry.callcount,
                                        "selfWallMs": round(entry.inlinetime * 1000, 3),
                                        "totalWallMs": round(entry.totaltime * 1000, 3),
                                    }
                                )
                            with sql_lock:
                                catalog_profiles[profile_index] = {
                                    "functionsBySelf": sorted(
                                        functions,
                                        key=lambda row: row["selfWallMs"],
                                        reverse=True,
                                    )[:40],
                                    "functionsByTotal": sorted(
                                        functions,
                                        key=lambda row: row["totalWallMs"],
                                        reverse=True,
                                    )[:40],
                                }
                        if response is not None:
                            response.close()

                class QuietHandler(WSGIRequestHandler):
                    def log_message(self, *_args):
                        pass

                from wsgiref.simple_server import make_server

                server = make_server(
                    "127.0.0.1",
                    0,
                    measured_app,
                    server_class=ThreadedWSGIServer,
                    handler_class=QuietHandler,
                )
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                targets = [
                    ("catalog", "/api/v1/catalog/materials", None, 200),
                    ("focus", "/api/v1/focus/lock-in", None, 200),
                    ("dashboard", "/api/v1/dashboard", None, 200),
                    ("pdf-full", f"/api/v1/files/{managed.id}/view", None, 200),
                    (
                        "pdf-range",
                        f"/api/v1/files/{managed.id}/view",
                        "bytes=0-65535",
                        206,
                    ),
                ]

                def fetch(index):
                    label, path, byte_range, expected = targets[index % len(targets)]
                    headers = {
                        "Cookie": sessions[index % len(sessions)],
                        "X-Lockin-Perf-Id": str(index),
                        "User-Agent": "Lockin synthetic performance lab",
                    }
                    if byte_range:
                        headers["Range"] = byte_range
                    started = time.perf_counter()
                    count, digest, status, header_ms = 0, hashlib.sha256(), 0, None
                    cache_control, error = None, None
                    http_connection = http.client.HTTPConnection(
                        "127.0.0.1", server.server_port, timeout=15
                    )
                    try:
                        http_connection.request("GET", path, headers=headers)
                        with http_connection.getresponse() as response:
                            status = response.status
                            header_ms = (time.perf_counter() - started) * 1000
                            cache_control = response.headers.get("Cache-Control")
                            while piece := response.read(65536):
                                count += len(piece)
                                digest.update(piece)
                        if status != expected:
                            error = "unexpected_status"
                        if label.startswith("pdf"):
                            expected_bytes = (
                                file_bytes[:65536] if byte_range else file_bytes
                            )
                            if (
                                count != len(expected_bytes)
                                or digest.hexdigest()
                                != hashlib.sha256(expected_bytes).hexdigest()
                            ):
                                error = "byte_mismatch"
                            if cache_control != "private, no-store":
                                error = "unexpected_cache_policy"
                    except (
                        OSError,
                        TimeoutError,
                        http.client.HTTPException,
                    ) as exception:
                        error = type(exception).__name__
                    finally:
                        http_connection.close()
                    return {
                        "id": index,
                        "endpoint": label,
                        "status": status,
                        "headersMs": round(header_ms, 2)
                        if header_ms is not None
                        else None,
                        "completeMs": round((time.perf_counter() - started) * 1000, 2),
                        "bytes": count,
                        "error": error,
                    }

                started = time.perf_counter()
                try:
                    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
                        records = list(executor.map(fetch, range(args.requests)))
                finally:
                    server.shutdown()
                    thread.join(timeout=5)
                    server.server_close()
                elapsed = time.perf_counter() - started
                for record in records:
                    record.update(sql_records.get(str(record["id"]), {}))
                if any("queries" not in record for record in records):
                    raise RuntimeError("Missing SQL capture for an HTTP sample")
                summary = {
                    label: {
                        "samples": len(
                            rows := [row for row in records if row["endpoint"] == label]
                        ),
                        "completeMs": percentiles([row["completeMs"] for row in rows]),
                        "headersMs": percentiles(
                            [
                                row["headersMs"]
                                for row in rows
                                if row["headersMs"] is not None
                            ]
                        )
                        if any(row["headersMs"] is not None for row in rows)
                        else None,
                        "queryCounts": sorted(
                            {row["queries"] for row in rows if "queries" in row}
                        ),
                        "errors": sum(row["error"] is not None for row in rows),
                    }
                    for label, *_ in targets
                }
                query_plans = []
                if args.query_plans:
                    if not catalog_queries or len(catalog_queries) > 40:
                        raise RuntimeError("Expected a bounded catalog SELECT capture")

                    def plan_shape(node):
                        # Numeric cost/buffer/row evidence only: exclude filters,
                        # constants, account identifiers and raw query text.
                        fields = (
                            "Node Type",
                            "Relation Name",
                            "Index Name",
                            "Plan Rows",
                            "Actual Rows",
                            "Actual Loops",
                            "Actual Total Time",
                            "Shared Hit Blocks",
                            "Shared Read Blocks",
                            "Rows Removed by Filter",
                        )
                        shape = {key: node[key] for key in fields if key in node}
                        if "Plans" in node:
                            shape["Plans"] = [
                                plan_shape(child) for child in node["Plans"]
                            ]
                        return shape

                    # These diagnostic reruns are outside HTTP timing/SQL budgets,
                    # on the same owned synthetic DB, with read-only enforcement.
                    with transaction.atomic(), connection.cursor() as cursor:
                        cursor.execute("SET LOCAL transaction_read_only = on")
                        cursor.execute("SET LOCAL statement_timeout = '2000ms'")
                        for sql in catalog_queries:
                            cursor.execute(
                                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql
                            )
                            plan = cursor.fetchone()[0][0]
                            query_plans.append(
                                {
                                    "sqlSHA256": hashlib.sha256(
                                        sql.encode()
                                    ).hexdigest(),
                                    "planningMs": plan["Planning Time"],
                                    "executionMs": plan["Execution Time"],
                                    "plan": plan_shape(plan["Plan"]),
                                }
                            )
                evidence = {
                    "schema": 2,
                    "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "environment": {
                        "database": "isolated synthetic PostgreSQL",
                        "postgresVersion": connection.pg_version,
                        "http": (
                            "loopback threaded development WSGI, instrumented SQL; "
                            "no Gunicorn/edge/network throttle"
                        ),
                        "users": 4,
                        "documents": args.catalog_sheets,
                        "profiledDiagnostic": args.profile_catalog,
                        "statistics": "ANALYZE before HTTP"
                        if args.query_plans
                        else "fresh fixture defaults",
                        "pdfBytes": len(file_bytes),
                        "pdfFixture": fixture_name,
                        "pdfSHA256": hashlib.sha256(file_bytes).hexdigest(),
                        "concurrency": args.concurrency,
                        "cache": (
                            "new database and real synthetic logins; "
                            "OS/file caches warm during load"
                        ),
                    },
                    "elapsedSeconds": round(elapsed, 2),
                    "summary": summary,
                    "samples": records,
                    "catalogQueryPlans": query_plans,
                    "catalogFunctionWallProfiles": catalog_profiles,
                    "profileLimitations": "Optional first3 catalog requests; profiler overhead and socket/GIL wait included; no arguments, locals or student content captured",
                    "queryPlanLimitations": "Read-only diagnostic reruns after measured HTTP; warm local synthetic data, not production plans",
                }
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(evidence, indent=2), encoding="utf8")
                print(
                    json.dumps(
                        {
                            "summary": summary,
                            "requests": len(records),
                            "errors": sum(row["error"] is not None for row in records),
                        },
                        indent=2,
                    )
                )
                return int(any(row["error"] for row in records))
            finally:
                connections.close_all()
                if old_config is not None:
                    # setup_databases owns exactly the validated, newly created test DB.
                    teardown_databases(old_config, verbosity=0)


if __name__ == "__main__":
    raise SystemExit(main())

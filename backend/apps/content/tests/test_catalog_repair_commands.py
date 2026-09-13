import json
from io import StringIO

import pytest
from django.core.management import call_command

from apps.content.models import CatalogDocument, CatalogSubject
from apps.education.models import AcademicProgram, StudentCohort
from apps.education.tests.helpers import create_admin, published_path

from .helpers import published_pdf

pytestmark = pytest.mark.django_db


def _published_mapped_sheet():
    admin = create_admin(email="catalog-repair@example.com")
    _, subject, lesson = published_path(admin=admin)
    program = AcademicProgram.objects.create(
        code="catalog-repair", name_en="Repair", name_ar="Repair"
    )
    cohort = StudentCohort.objects.create(
        program=program, code="year-1", name_en="Year 1", name_ar="Year 1"
    )
    cohort.content_nodes.add(subject)
    catalog_subject = CatalogSubject.objects.create(
        cohort=cohort,
        source_node=subject,
        title="Anatomy",
        slug="anatomy",
        material_slug="catalog-repair-anatomy",
    )
    return published_pdf(actor=admin, node=lesson), catalog_subject


def _command_payload(name: str, **options):
    output = StringIO()
    call_command(name, stdout=output, **options)
    return json.loads(output.getvalue())


def test_backfill_catalog_documents_is_dry_run_by_default_and_idempotent() -> None:
    sheet, catalog_subject = _published_mapped_sheet()

    report = _command_payload("backfill_catalog_documents")

    assert report["mode"] == "dry-run"
    assert report["sheets"][0]["state"] == "missing"
    assert not CatalogDocument.objects.filter(version__learning_object=sheet).exists()

    applied = _command_payload("backfill_catalog_documents", apply=True)
    document = CatalogDocument.objects.get(version__learning_object=sheet)
    assert applied["repaired"] == 1
    assert document.material_slug == catalog_subject.material_slug
    assert _command_payload("backfill_catalog_documents", apply=True)["repaired"] == 0


def test_repair_catalog_slugs_preserves_sheet_slug_and_is_idempotent() -> None:
    sheet, catalog_subject = _published_mapped_sheet()
    version = sheet.published_version
    assert version is not None
    asset = version.assets.get(role="primary")
    document = CatalogDocument.objects.create(
        material_slug="stale-material",
        sheet_slug="stable-sheet-route",
        version=version,
        managed_file=asset.managed_file,
    )

    report = _command_payload("repair_catalog_document_slugs")

    assert report["mode"] == "dry-run"
    assert report["documents"][0]["state"] == "stale"
    document.refresh_from_db()
    assert document.material_slug == "stale-material"
    assert document.sheet_slug == "stable-sheet-route"

    applied = _command_payload("repair_catalog_document_slugs", apply=True)
    document.refresh_from_db()
    assert applied["repaired"] == 1
    assert document.material_slug == catalog_subject.material_slug
    assert document.sheet_slug == "stable-sheet-route"
    assert _command_payload("repair_catalog_document_slugs", apply=True)["affected"] == 0

from __future__ import annotations

import json
import subprocess
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import pytest
from django.core.management import CommandError, call_command

from apps.audit.models import AuditRecord
from apps.content.models import CatalogDocument, SheetPageTranslation
from apps.content.services import ContentConflictError, ContentRuleError
from apps.content.sheet_translation_batch import (
    BATCH_FORMAT_V1,
    SINGLE_FORMAT_V1,
    apply_translations,
    check_medical_terms_preserved,
    export_translation_manifest,
    extract_medical_terms,
    find_sheets_for_translation,
    format_preview_markdown,
    preview_translations,
    translate_manifest_with_gemini,
)
from apps.content.sheet_translation_pilot import (
    PILOT_ARABIC_TRANSLATIONS,
    PILOT_PAGE_COUNT,
    PILOT_SHEET_TITLE,
    build_pilot_translation_payload,
    ensure_general_pathology_intro_pilot,
)
from apps.education.tests.helpers import create_admin

from .helpers import published_pdf
from .test_catalog_workspace import client_for
from .test_study_assistance import context as context  # noqa: F401

pytestmark = pytest.mark.django_db


def import_endpoint(sheet_id: object, query: str = "") -> str:
    suffix = f"?{query}" if query else ""
    return f"/api/v1/operations/admin/content/sheets/{sheet_id}/translations/import{suffix}"


def student_endpoint(document_id: object, page: int = 1) -> str:
    return f"/api/v1/catalog/documents/{document_id}/translation?page={page}"


def test_medical_terminology_extraction_and_preservation_check() -> None:
    source = (
        "Hypertrophy and Hyperplasia are cellular adaptations, whereas Necrosis and "
        "Apoptosis represent cell death after Ischemia, Hypoxia and ATP depletion."
    )
    terms = extract_medical_terms(source)
    for expected in (
        "Hypertrophy",
        "Hyperplasia",
        "Necrosis",
        "Apoptosis",
        "Ischemia",
        "Hypoxia",
        "ATP",
    ):
        assert expected in terms

    arabic_preserving_terms = (
        "تُعدّ الضخامة (Hypertrophy) وفرط التنسّج (Hyperplasia) من التكيّفات الخلوية، "
        "بينما يمثّل النخر (Necrosis) والاستماتة (Apoptosis) موت الخلية بعد الإقفار "
        "(Ischemia) ونقص الأكسجة (Hypoxia) واستنزاف الطاقة (ATP)."
    )
    preserved, missing = check_medical_terms_preserved(
        source_text=source,
        translated_text=arabic_preserving_terms,
    )
    assert len(missing) == 0
    assert "Hypertrophy" in preserved
    assert "Apoptosis" in preserved

    arabic_missing_some = "تُعدّ الضخامة (Hypertrophy) من التكيّفات الخلوية."
    preserved_partial, missing_partial = check_medical_terms_preserved(
        source_text=source,
        translated_text=arabic_missing_some,
    )
    assert "Hypertrophy" in preserved_partial
    assert "Necrosis" in missing_partial
    assert "Apoptosis" in missing_partial


def test_pilot_general_pathology_introduction_university_preview_before_save(
    settings: pytest.MonkeyPatch,
) -> None:
    admin = create_admin(email="pathology-admin@example.com")
    sheet = ensure_general_pathology_intro_pilot(actor=admin)
    assert sheet.current_version is not None
    assert sheet.current_version.title == PILOT_SHEET_TITLE

    matched = find_sheets_for_translation(
        subject_query="Pathology",
        sheet_query="General Pathology — Introduction",
    )
    assert [item.id for item in matched] == [sheet.id]

    manifest = export_translation_manifest(
        sheets=matched,
        edition="university",
        extract_pdf_source=True,
        single_sheet_format=True,
    )
    assert manifest["format"] == SINGLE_FORMAT_V1
    assert manifest["edition"] == "university"
    assert manifest["page_count"] == PILOT_PAGE_COUNT == 10
    assert len(manifest["pages"]) == 10
    assert "GENERAL PATHOLOGY" in manifest["pages"][0]["source_text"]
    assert "Epidemiology" in manifest["pages"][1]["source_text"]
    assert "Etiology" in manifest["pages"][2]["source_text"]
    assert "Pathogenesis" in manifest["pages"][3]["source_text"]
    assert "Prognosis" in manifest["pages"][4]["source_text"]
    assert "Tuberculosis" in manifest["pages"][5]["source_text"]
    assert "Autoimmune" in manifest["pages"][6]["source_text"]
    assert "Neoplastic" in manifest["pages"][7]["source_text"]
    assert "Iatrogenic" in manifest["pages"][8]["source_text"]
    assert "Autopsy" in manifest["pages"][9]["source_text"]

    payload = build_pilot_translation_payload(sheet, edition="university")
    preview = preview_translations(raw=payload, actor=admin)
    assert preview["mode"] == "preview"
    assert preview["saved"] is False
    assert preview["edition"] == "university"
    assert preview["sheet_count"] == 1
    assert preview["total_pages"] == 10
    assert preview["translated_count"] == 10
    assert preview["changed_count"] == 10
    assert preview["preview_token"]
    assert SheetPageTranslation.objects.count() == 0

    med_summary = preview["sheets"][0]["medical_terms_summary"]
    assert med_summary["all_source_medical_terms_preserved"] is True
    assert med_summary["missing_count"] == 0
    assert med_summary["preserved_count"] >= 40

    markdown = format_preview_markdown(preview)
    assert PILOT_SHEET_TITLE in markdown
    assert "لم يتم الحفظ في قاعدة البيانات بعد" in markdown
    assert "Pathogenesis" in markdown

    with pytest.raises(ContentRuleError):
        build_pilot_translation_payload(sheet, edition="lockin")

    settings.ENVIRONMENT = "production"
    with pytest.raises(ContentRuleError):
        apply_translations(
            raw=payload,
            preview_token=preview["preview_token"],
            actor=admin,
            allow_production=False,
        )
    settings.ENVIRONMENT = "testing"

    saved = apply_translations(
        raw=payload,
        preview_token=preview["preview_token"],
        actor=admin,
    )
    assert saved["mode"] == "saved"
    assert saved["saved"] is True
    assert saved["translated_count"] == 10
    assert (
        SheetPageTranslation.objects.filter(
            managed_file_id=payload["file_id"],
            checksum=payload["checksum"],
        ).count()
        == 10
    )
    assert AuditRecord.objects.filter(
        action="content.sheet_translations_saved",
        target_id=str(sheet.id),
    ).exists()


def test_admin_import_endpoint_subject_manifest_preview_and_confirm_flow(context: tuple) -> None:
    document, student, *_ = context
    document.managed_file.pdf_page_count = 3
    document.managed_file.save(update_fields=["pdf_page_count"])
    owner = document.version.learning_object.owner
    second_sheet = published_pdf(
        actor=owner,
        node=document.version.academic_node,
        title="General Pathology — Cellular Injury",
    )
    assert second_sheet.published_version is not None
    second_asset = second_sheet.published_version.assets.first()
    assert second_asset is not None
    second_file = second_asset.managed_file
    second_file.pdf_page_count = 3
    second_file.save(update_fields=["pdf_page_count"])
    admin_client = client_for(owner)
    student_client = client_for(student)

    # Students cannot access admin translation import endpoints.
    assert (
        student_client.get(import_endpoint(document.version.learning_object_id)).status_code == 403
    )

    subject_manifest_res = admin_client.get(
        import_endpoint(document.version.learning_object_id, "scope=subject&edition=university")
    )
    assert subject_manifest_res.status_code == 200, subject_manifest_res.content
    subject_manifest = subject_manifest_res.json()
    assert subject_manifest["format"] == BATCH_FORMAT_V1
    assert {row["sheet_id"] for row in subject_manifest["sheets"]} == {
        str(document.version.learning_object_id),
        str(second_sheet.id),
    }

    batch_payload = {
        "format": BATCH_FORMAT_V1,
        "edition": "university",
        "sheets": [
            {
                "sheet_id": row["sheet_id"],
                "file_id": row["file_id"],
                "checksum": row["checksum"],
                "pages": [
                    {
                        "page": 1,
                        "source_text": "Pathology and Apoptosis overview.",
                        "text": (
                            "نظرة عامة على علم الأمراض (Pathology) "
                            f"والاستماتة (Apoptosis) - {row['title']}."
                        ),
                        "expected_revision": 0,
                    }
                ],
            }
            for row in subject_manifest["sheets"]
        ],
    }

    assert (
        student_client.post(
            import_endpoint(document.version.learning_object_id),
            {"payload": batch_payload},
            format="json",
        ).status_code
        == 403
    )

    preview_res = admin_client.post(
        import_endpoint(document.version.learning_object_id),
        {"payload": batch_payload},
        format="json",
    )
    assert preview_res.status_code == 200, preview_res.content
    preview_data = preview_res.json()
    assert preview_data["saved"] is False
    assert preview_data["sheet_count"] == 2
    assert preview_data["changed_count"] == 2
    assert SheetPageTranslation.objects.count() == 0

    # Tampered token or modified payload after preview must be rejected with 409.
    assert (
        admin_client.post(
            import_endpoint(document.version.learning_object_id),
            {"payload": batch_payload, "preview_token": "tampered-token"},
            format="json",
        ).status_code
        == 409
    )
    mutated_payload = json.loads(json.dumps(batch_payload))
    mutated_payload["sheets"][0]["pages"][0]["text"] = "نص معدل بعد المعاينة"
    assert (
        admin_client.post(
            import_endpoint(document.version.learning_object_id),
            {"payload": mutated_payload, "preview_token": preview_data["preview_token"]},
            format="json",
        ).status_code
        == 409
    )
    assert SheetPageTranslation.objects.count() == 0

    # Confirming with the exact preview_token saves both sheets atomically.
    save_res = admin_client.post(
        import_endpoint(document.version.learning_object_id),
        {"payload": batch_payload, "preview_token": preview_data["preview_token"]},
        format="json",
    )
    assert save_res.status_code == 200, save_res.content
    save_data = save_res.json()
    assert save_data["saved"] is True
    assert save_data["translated_count"] == 2
    assert SheetPageTranslation.objects.count() == 2

    # Student can now read the saved Arabic translation with preserved medical terms.
    student_read = student_client.get(student_endpoint(document.id, 1))
    assert student_read.status_code == 200
    assert student_read.json()["status"] == "ready"
    assert "Pathology" in student_read.json()["translated_text"]
    assert "Apoptosis" in student_read.json()["translated_text"]


def test_translate_sheets_cli_command_end_to_end(tmp_path: Path) -> None:
    payload_file = tmp_path / "pilot_payload.json"
    preview_md_file = tmp_path / "pilot_preview.md"
    saved_out_file = tmp_path / "pilot_saved.json"

    out = StringIO()
    call_command(
        "translate_sheets",
        "--seed-pilot",
        "--sheet",
        PILOT_SHEET_TITLE,
        "--edition",
        "university",
        "--action",
        "preview",
        "--output",
        str(payload_file),
        "--preview-markdown",
        str(preview_md_file),
        stdout=out,
    )
    preview_json = json.loads(out.getvalue())
    assert preview_json["mode"] == "preview"
    assert preview_json["saved"] is False
    assert preview_json["translated_count"] == 10
    assert SheetPageTranslation.objects.count() == 0
    assert payload_file.exists()
    assert preview_md_file.exists()
    assert PILOT_SHEET_TITLE in preview_md_file.read_text(encoding="utf-8")

    # Saving without preview_token must fail.
    written_payload = json.loads(payload_file.read_text(encoding="utf-8"))
    token = written_payload.pop("preview_token")
    written_payload.pop("preview", None)
    clean_payload_file = tmp_path / "clean_payload.json"
    clean_payload_file.write_text(
        json.dumps(written_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    with pytest.raises(CommandError, match="preview-token is required"):
        call_command(
            "translate_sheets",
            "--action",
            "save",
            "--input",
            str(clean_payload_file),
        )
    assert SheetPageTranslation.objects.count() == 0

    # Saving with the signed preview_token persists all 10 pages.
    save_out = StringIO()
    call_command(
        "translate_sheets",
        "--action",
        "save",
        "--input",
        str(clean_payload_file),
        "--preview-token",
        token,
        "--actor-email",
        "admin@lockin.local",
        "--output",
        str(saved_out_file),
        stdout=save_out,
    )
    saved_json = json.loads(save_out.getvalue())
    assert saved_json["mode"] == "saved"
    assert saved_json["saved"] is True
    assert saved_json["translated_count"] == 10
    assert SheetPageTranslation.objects.count() == 10

    for page_num, expected_ar in PILOT_ARABIC_TRANSLATIONS.items():
        row = SheetPageTranslation.objects.get(page=page_num)
        assert row.translated_text == expected_ar
        assert row.revision == 1
        assert row.source_text != ""

    doc = CatalogDocument.objects.filter(
        version__learning_object_id=written_payload["sheet_id"],
        edition="university",
        is_active=True,
    ).first()
    assert doc is not None


def test_gemini_cli_translation_from_pdf_source_without_premade_arabic(
    tmp_path: Path,
) -> None:
    admin = create_admin(email="gemini-admin@example.com")
    sheet = ensure_general_pathology_intro_pilot(actor=admin)
    manifest = export_translation_manifest(
        sheets=[sheet],
        edition="university",
        extract_pdf_source=True,
        single_sheet_format=True,
    )
    # Confirm extracted manifest has empty Arabic text (`text == ""`)
    # and real English `source_text`.
    assert len(manifest["pages"]) == 10
    for page_row in manifest["pages"]:
        assert page_row["text"] == ""
        assert page_row["source_text"].strip() != ""

    def fake_agy_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        assert "--sandbox" in cmd
        assert "--input-format" in cmd
        assert "--print" not in " ".join(cmd)
        streamed = json.loads(str(kwargs["input"]).strip())
        assert streamed["event"] == "user"
        prompt_body = streamed["message"]["content"].split("INPUT_PAGES_JSON:\n", 1)[1]
        input_pages = json.loads(prompt_body)
        out_pages = []
        for item in input_pages:
            pno = int(item.get("page", item.get("page_number")))
            terms = item["required_medical_terms"]
            terms_str = ", ".join(f"({t})" for t in terms)
            out_pages.append(
                {
                    "page": pno,
                    "translated_text": (
                        f"ترجمة عربية تلقائية عبر Gemini للصفحة {pno}: {terms_str}"
                    ),
                }
            )
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=0,
            stdout=json.dumps({
                "event": "result",
                "result": {
                    "status": "SUCCESS",
                    "response": json.dumps({"pages": out_pages}, ensure_ascii=False),
                },
            }, ensure_ascii=False) + "\n",
            stderr="",
        )

    with (
        patch(
            "apps.content.sheet_translation_batch.resolve_agy_binary",
            return_value="/usr/bin/agy",
        ),
        patch(
            "apps.content.sheet_translation_batch.subprocess.run",
            side_effect=fake_agy_run,
        ) as mock_run,
    ):
        translated = translate_manifest_with_gemini(manifest, batch_size=5)
        assert mock_run.call_count == 2
        assert translated["translation_engine"]["provider"] == "google_ai_pro_antigravity_cli"
        assert translated["translation_engine"]["paid_api_used"] is False
        assert len(translated["pages"]) == 10
        for page_row in translated["pages"]:
            assert "ترجمة عربية تلقائية عبر Gemini" in page_row["text"]

        out_json = tmp_path / "gemini_translated_payload.json"
        out_md = tmp_path / "gemini_translated_preview.md"
        cli_out = StringIO()
        call_command(
            "translate_sheets",
            "--sheet-id",
            str(sheet.id),
            "--edition",
            "university",
            "--action",
            "translate",
            "--output",
            str(out_json),
            "--preview-markdown",
            str(out_md),
            stdout=cli_out,
        )
        preview_data = json.loads(cli_out.getvalue())
        assert preview_data["mode"] == "preview"
        assert preview_data["saved"] is False
        assert preview_data["translated_count"] == 10
        assert (
            preview_data["sheets"][0]["medical_terms_summary"]["all_source_medical_terms_preserved"]
            is True
        )
        assert SheetPageTranslation.objects.count() == 0


def test_stale_revision_after_preview_blocks_save() -> None:
    admin = create_admin(email="conflict-admin@example.com")
    sheet = ensure_general_pathology_intro_pilot(actor=admin)
    payload = build_pilot_translation_payload(sheet, edition="university")
    preview = preview_translations(raw=payload, actor=admin)

    # Simulate another administrator saving page 1 before preview_token is confirmed.
    SheetPageTranslation.objects.create(
        managed_file_id=payload["file_id"],
        checksum=payload["checksum"],
        page=1,
        source_text="Concurrent edit",
        translated_text="تعديل متزامن",
        revision=1,
    )
    with pytest.raises(ContentConflictError):
        apply_translations(
            raw=payload,
            preview_token=preview["preview_token"],
            actor=admin,
        )
    assert SheetPageTranslation.objects.count() == 1


def test_dental_terms_preserved_verbatim_not_translated_to_wrong_anatomy() -> None:
    from apps.content.sheet_translation_batch import (
        _ensure_all_medical_terms_in_translation,
    )

    source = "Enamel protects Dentin and the Pulp. Cementum covers the root."
    terms = extract_medical_terms(source)
    for term in ("Enamel", "Dentin", "Pulp", "Cementum"):
        assert term in terms

    # The Arabic word عاج by itself must never count as preserving Enamel.
    with pytest.raises(ContentRuleError, match="Enamel"):
        _ensure_all_medical_terms_in_translation(
            source_text=source,
            translated_text="يحمي العاج الطبقة الداخلية (Dentin) وPulp وCementum.",
        )
    correct = _ensure_all_medical_terms_in_translation(
        source_text=source,
        translated_text="==طبقة Enamel تحمي Dentin وPulp.== ويغطي Cementum جذر السن (root).",
    )
    assert "Enamel" in correct
    assert "عاج" not in correct
    preserved, missing = check_medical_terms_preserved(
        source_text="Enamel and Dentin",
        translated_text="Enamelworks with Dentin.",
    )
    assert "Enamel" in missing  # substring in another word is not valid
    assert "Dentin" in preserved


def test_gemini_skips_previously_translated_pages_without_running_cli() -> None:
    source = {
        "format": SINGLE_FORMAT_V1,
        "sheet_id": "00000000-0000-0000-0000-000000000000",
        "title": "Enamel",
        "pages": [
            {"page": 1, "source_text": "Enamel", "text": "ترجمة محفوظة: Enamel"},
            {"page": 2, "source_text": "", "text": ""},
        ],
    }
    with patch("apps.content.sheet_translation_batch.translate_pages_with_gemini") as translated:
        result = translate_manifest_with_gemini(source)
    translated.assert_not_called()
    assert result["pages"][0]["text"] == "ترجمة محفوظة: Enamel"
    assert result["untranslated_pages"] == [2]


def test_batch_save_requires_explicit_authorized_actor() -> None:
    admin = create_admin(email="must-identify-actor@example.com")
    sheet = ensure_general_pathology_intro_pilot(actor=admin)
    payload = build_pilot_translation_payload(sheet)
    preview = preview_translations(raw=payload, actor=None)
    with pytest.raises(ContentRuleError, match="explicitly authenticated"):
        apply_translations(
            raw=payload,
            preview_token=preview["preview_token"],
            actor=None,
        )
    assert SheetPageTranslation.objects.count() == 0


def test_confirmed_save_does_not_touch_unchanged_translation_revisions() -> None:
    admin = create_admin(email="idempotent-translations@example.com")
    sheet = ensure_general_pathology_intro_pilot(actor=admin)
    payload = build_pilot_translation_payload(sheet)
    preview = preview_translations(raw=payload, actor=admin)
    apply_translations(raw=payload, preview_token=preview["preview_token"], actor=admin)

    rows_before = list(
        SheetPageTranslation.objects.order_by("page").values_list("page", "revision")
    )
    audits_before = AuditRecord.objects.filter(
        action="content.sheet_translations_saved",
        target_id=str(sheet.id),
    ).count()

    existing_manifest = export_translation_manifest(
        sheets=[sheet],
        edition="university",
        extract_pdf_source=True,
        single_sheet_format=True,
    )
    again = preview_translations(raw=existing_manifest, actor=admin)
    assert again["changed_count"] == 0
    saved_again = apply_translations(
        raw=existing_manifest,
        preview_token=again["preview_token"],
        actor=admin,
    )
    assert saved_again["changed_count"] == 0
    assert (
        list(SheetPageTranslation.objects.order_by("page").values_list("page", "revision"))
        == rows_before
    )
    assert AuditRecord.objects.filter(
        action="content.sheet_translations_saved",
        target_id=str(sheet.id),
    ).count() == audits_before


def test_long_extracted_pdf_page_is_not_silently_truncated() -> None:
    from apps.content.sheet_translation_batch import _normalize_extracted_page_text

    with pytest.raises(ContentRuleError, match="instead of silently cutting off"):
        _normalize_extracted_page_text("A" * 60001)

"""Isolated generation tests: no model calls or production PDF access in CI."""

from __future__ import annotations

import json
import os
import subprocess
from uuid import UUID

import pytest
from django.core.management import CommandError

from apps.content.companion_antigravity import (
    CompanionGenerationError,
    _parse_cards_response,
    generate_companion_import,
)
from apps.content.management.commands.generate_companion_cards import _private_json_file

from .test_study_assistance import context as context  # noqa: F401

SUBJECT_ID = "00000000-0000-4000-8000-000000000001"
SHEET_ID = "00000000-0000-4000-8000-000000000002"
VERSION_ID = "00000000-0000-4000-8000-000000000003"
SOURCE = (
    "Enamel is the hard external tissue of the tooth crown. "
    "Dentin is beneath enamel and surrounds the pulp."
)
QUOTE = "Enamel is the hard external tissue of the tooth crown."


def response(*, page: int = 1, quote: str = QUOTE, kind: str = "understand") -> str:
    return json.dumps(
        {
            "cards": [
                {
                    "page": page,
                    "kind": kind,
                    "teaser": "دقيقة عن Enamel",
                    "question": "أين توجد Enamel؟",
                    "explanation": "تغطي Enamel تاج السن، وتوجد Dentin أسفلها.",
                    "source_quote": quote,
                    "followup_question": "ما النسيج الذي يقع تحت Enamel؟",
                    "followup_answer": "Dentin",
                }
            ]
        },
        ensure_ascii=False,
    )


def test_companion_generation_retains_source_page_and_strips_private_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from apps.content import companion_antigravity as module

    class FakeSheet:
        id = UUID(SHEET_ID)

    monkeypatch.setattr(
        module,
        "manifest",
        lambda sheet, edition, view: {
            "subject_id": SUBJECT_ID,
            "edition": edition,
            "view": view,
            "sheets": [
                {
                    "sheet_id": SHEET_ID,
                    "source_version_id": VERSION_ID,
                    "title": "Dental Histology",
                    "page_count": 1,
                }
            ],
        },
    )
    monkeypatch.setattr(module, "resolve_agy_binary", lambda bin_path: "/usr/bin/agy")
    subprocess_calls = []

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        subprocess_calls.append((command, kwargs))
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps(
                {"event": "result", "result": {"status": "SUCCESS", "response": response()}},
                ensure_ascii=False,
            ),
            stderr="",
        )

    payload, report = generate_companion_import(
        sheet=FakeSheet(),
        edition="university",
        view="study",
        reader=lambda **kwargs: ({1: SOURCE}, 1),
        runner=fake_run,
    )
    assert payload["subject_id"] == SUBJECT_ID
    assert payload["sheets"][0]["source_version_id"] == VERSION_ID
    assert payload["sheets"][0]["cards"][0]["page"] == 1
    assert payload["sheets"][0]["cards"][0]["kind"] == "understand"
    assert payload["sheets"][0]["cards"][0]["key"].startswith("agy-1-")
    assert "source_quote" not in payload["sheets"][0]["cards"][0]
    assert "_source_quote" not in payload["sheets"][0]["cards"][0]
    assert report["evidence"][0]["source_quote"] == QUOTE
    assert report["status"] == "draft_needs_admin_review"
    assert report["pages_without_text"] == []
    assert report["pages_not_submitted"] == []
    assert len(subprocess_calls) == 1
    command, arguments = subprocess_calls[0]
    assert "--sandbox" in command
    assert "--input-format" in command
    assert "--print" not in " ".join(command)
    assert SOURCE not in " ".join(command)
    streamed = json.loads(str(arguments["input"]).strip())
    assert SOURCE in streamed["message"]["content"]
    assert "DATABASE_URL" not in arguments["env"]
    assert "SECRET_KEY" not in arguments["env"]


@pytest.mark.parametrize(
    ("page", "quote", "kind"),
    [
        (9, QUOTE, "understand"),
        (1, "This statement does not appear in the real PDF.", "understand"),
        (1, QUOTE, "invented_kind"),
    ],
)
def test_companion_rejects_unverifiable_card_content(page: int, quote: str, kind: str) -> None:
    with pytest.raises(CompanionGenerationError):
        _parse_cards_response(
            response(page=page, quote=quote, kind=kind),
            pages={1: SOURCE},
            budget=3,
        )


def test_companion_rejects_swapped_dental_labels_and_missing_english_terms() -> None:
    wrong_label = json.loads(response())
    wrong_label["cards"][0]["explanation"] = "Enamel (عاج) تغطي تاج السن."
    with pytest.raises(CompanionGenerationError, match="confuses"):
        _parse_cards_response(
            json.dumps(wrong_label, ensure_ascii=False),
            pages={1: SOURCE},
            budget=3,
        )

    missing_english = json.loads(response())
    missing_english["cards"][0].update(
        teaser="تذكير دراسي",
        question="ما هي الطبقة الخارجية؟",
        explanation="تغطي الطبقة الخارجية تاج السن.",
        followup_question="أين تقع؟",
        followup_answer="خارج السن.",
    )
    with pytest.raises(CompanionGenerationError, match="English medical"):
        _parse_cards_response(
            json.dumps(missing_english, ensure_ascii=False),
            pages={1: SOURCE},
            budget=3,
        )


def test_companion_rejects_excessive_card_output() -> None:
    with pytest.raises(CompanionGenerationError, match="within the limit"):
        _parse_cards_response(json.dumps({"cards": [{}, {}]}), pages={1: SOURCE}, budget=1)


def test_generated_json_output_is_private_and_never_silently_overwritten(
    tmp_path,
) -> None:
    path = tmp_path / "companion.json"
    _private_json_file(str(path), {"schema_version": 1})
    assert json.loads(path.read_text(encoding="utf-8")) == {"schema_version": 1}
    assert os.stat(path).st_mode & 0o777 == 0o600
    with pytest.raises(CommandError):
        _private_json_file(str(path), {"schema_version": 2})
    assert json.loads(path.read_text(encoding="utf-8")) == {"schema_version": 1}


@pytest.mark.django_db
def test_opt_in_import_creates_only_unpublished_companion_drafts(
    context, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from django.core.management import call_command

    from apps.content.models import StudyAssistanceIdea

    from .test_assistance_import import payload as import_payload

    document, *_ = context
    sheet = document.version.learning_object
    actor = sheet.owner
    raw = import_payload(document)
    review = {
        "cards": 1,
        "pages_with_text": 1,
        "physical_page_count": 1,
        "pages_without_text": [],
        "pages_not_submitted": [],
    }
    monkeypatch.setattr(
        "apps.content.management.commands.generate_companion_cards.generate_companion_import",
        lambda **kwargs: (raw, review),
    )
    path = tmp_path / "generated.json"
    call_command(
        "generate_companion_cards",
        "--sheet-id",
        str(sheet.id),
        "--actor-email",
        actor.email,
        "--output",
        str(path),
        "--import-drafts",
    )
    assert path.is_file()
    assert StudyAssistanceIdea.objects.count() == 1
    record = StudyAssistanceIdea.objects.get()
    assert record.is_published is False
    assert record.question == "Short title"

    # Repeating the same generated key does not create a second card.
    call_command(
        "generate_companion_cards",
        "--sheet-id",
        str(sheet.id),
        "--actor-email",
        actor.email,
        "--output",
        str(tmp_path / "generated-again.json"),
        "--import-drafts",
    )
    assert StudyAssistanceIdea.objects.count() == 1
    record.refresh_from_db()
    assert record.is_published is False
    assert record.revision == 1

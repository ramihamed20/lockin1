import pytest
from django.test import override_settings
from django.utils import timezone

from apps.content.models import ActiveStudyQuestionContent
from apps.content.tests.test_catalog_workspace import client_for
from apps.focus.models import ActiveStudyAnswer, ActiveStudyAttempt, ActiveStudyRun
from apps.knowledge.models import McqConceptLink

from .test_api import base

pytestmark = pytest.mark.django_db


@pytest.fixture
def mistake(setup):
    document, user, _, _, concept, _ = setup
    bank = ActiveStudyQuestionContent.objects.create(
        sheet=concept.sheet,
        difficulty="easy",
        payload={},
        plan_signature={},
        checkpoint_question_count=1,
        final_exam_question_count=1,
        created_by=user,
        updated_by=user,
        source_version=document.version,
    )
    run = ActiveStudyRun.objects.create(
        user=user,
        sheet=concept.sheet,
        material_slug="anatomy",
        sheet_slug="cranial-nerves",
        difficulty="easy",
        page_count=1,
        unlocked_pages=1,
    )
    attempt = ActiveStudyAttempt.objects.create(
        run=run,
        kind="checkpoint",
        part_number=1,
        number=1,
        total=2,
        submitted_at=timezone.now(),
    )
    ActiveStudyAnswer.objects.create(
        attempt=attempt,
        question_position=1,
        selected_answer="A",
        was_correct=False,
    )
    ActiveStudyAnswer.objects.create(
        attempt=attempt,
        question_position=2,
        selected_answer="B",
        was_correct=True,
    )
    for position in (1, 2):
        McqConceptLink.objects.create(
            concept=concept,
            canonical_key=f"active-study:{concept.sheet_id}:easy:checkpoint:1:{position}",
            bank_revision=bank.revision,
        )
    return bank, attempt


@override_settings(KNOWLEDGE_ENABLED=True)
def test_links_only_owned_server_mistakes_to_prepared_current_questions(setup, mistake):
    document, user, second, _, _, question = setup
    _, attempt = mistake
    path = f"{base(document)}/mcq-attempts/{attempt.id}/explain-links"
    response = client_for(user).get(path)
    assert response.status_code == 200
    assert response.json()["availability"] == "available"
    assert [link["position"] for link in response.json()["links"]] == [1]
    assert response.json()["links"][0]["question_id"] == str(question.id)
    assert "reference_answer" not in response.content.decode()
    assert client_for(second).get(path).status_code == 404
    question.published = False
    question.save()
    assert client_for(user).get(path).json()["links"] == []


@override_settings(KNOWLEDGE_ENABLED=True)
def test_reimported_bank_and_unsubmitted_attempt_never_offer_links(setup, mistake):
    document, user, *_ = setup
    bank, attempt = mistake
    path = f"{base(document)}/mcq-attempts/{attempt.id}/explain-links"
    bank.revision += 1
    bank.save()
    assert client_for(user).get(path).json()["links"] == []
    attempt.submitted_at = None
    attempt.save()
    assert client_for(user).get(path).status_code == 404


@override_settings(KNOWLEDGE_ENABLED=True)
def test_resumed_result_resolves_its_owned_submitted_attempt(setup, mistake):
    document, user, second, *_ = setup
    _, attempt = mistake
    run = attempt.run
    run.stage = "checkpoint_result"
    run.save(update_fields=["stage"])
    path = f"{base(document)}/mcq-runs/{run.id}/explain-links"
    assert client_for(user).get(path).json()["links"][0]["position"] == 1
    assert client_for(second).get(path).status_code == 404
    run.stage = "reading"
    run.save(update_fields=["stage"])
    assert client_for(user).get(path).status_code == 404


@override_settings(KNOWLEDGE_ENABLED=True)
def test_page_customization_uses_question_identity_instead_of_legacy_part_position(setup, mistake):
    document, user, _, _, concept, question = setup
    bank, attempt = mistake
    bank.payload = {"pages": [{"page": 2, "questions": [{"question": f"Q{i}"} for i in range(20)]}]}
    bank.plan_signature = {"page_ranges": [{"part": 1, "start_page": 2, "end_page": 2}]}
    bank.save(update_fields=("payload", "plan_signature"))
    run = attempt.run
    run.study_mode = "custom"
    run.plan_signature = {
        "page_ranges": [{"part": 1, "start_page": 2, "end_page": 2}],
        "content_revision": bank.revision,
        "source_page_offset": 0,
        "questions_per_checkpoint": 2,
    }
    run.save(update_fields=("study_mode", "plan_signature"))
    path = f"{base(document)}/mcq-attempts/{attempt.id}/explain-links"
    assert client_for(user).get(path).json()["links"] == [], (
        "Old part-position links must not match a custom question."
    )
    McqConceptLink.objects.create(
        concept=concept,
        bank_revision=bank.revision,
        canonical_key=f"active-study:{run.sheet_id}:easy:bank:{bank.revision}:page:2:question:1",
    )
    response = client_for(user).get(path)
    assert response.json()["links"][0]["question_id"] == str(question.id)

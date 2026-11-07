from uuid import uuid4

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.content.models import ActiveStudyQuestionContent
from apps.content.tests.test_catalog_workspace import client_for
from apps.knowledge.models import ExplainAttempt, McqConceptLink, StudentArtifact
from apps.knowledge.serializers import validate_content
from apps.review.models import ReviewItem

from .test_api import base, body

pytestmark = pytest.mark.django_db


@override_settings(KNOWLEDGE_ENABLED=True)
def test_recall_preserves_original_and_is_owned_ungraded_work(setup):
    doc, user, second, _, _, _ = setup
    artifact = uuid4()
    content = {
        "text": "My original",
        "recall": {"answer": "My recall", "reflection": "Missing idea", "revealed": True},
    }
    path = f"{base(doc)}/artifacts/{artifact}"
    response = client_for(user).put(path, body(doc, content=content), format="json")
    assert response.status_code == 200, response.json()
    assert StudentArtifact.objects.get(pk=artifact).content == content
    assert client_for(user).get(base(doc)).json()["concepts"][0]["status"] == "not_practiced"
    assert client_for(second).get(path).status_code == 404


@pytest.mark.parametrize("value", [{"grade": 100}, {"revealed": "true"}, {"answer": "x" * 10001}])
def test_recall_is_bounded_and_cannot_claim_a_grade(value):
    with pytest.raises(ValidationError):
        validate_content({"recall": value}, "summary")


@override_settings(KNOWLEDGE_ENABLED=True)
def test_confidence_and_error_reason_share_attempt_idempotency(setup):
    doc, user, second, _, _, question = setup
    path = f"{base(doc)}/attempts/{uuid4()}"
    data = {
        "account_id": str(user.pk),
        "question_id": str(question.pk),
        "question_revision": question.revision,
        "answer": "My explanation",
        "confidence": "high",
        "error_reason": "confused",
        "self_rating": "partial",
    }
    client = client_for(user)
    result = client.put(path, data, format="json")
    assert result.status_code == 200, result.json()
    assert result.json()["confidence"] == "high" and result.json()["error_reason"] == "confused"
    assert result.json()["evaluation_status"] == "self_review"
    assert client.put(path, data, format="json").status_code == 200
    assert ExplainAttempt.objects.count() == 1
    assert client.put(path, {**data, "confidence": "low"}, format="json").status_code == 409
    assert (
        client_for(second)
        .put(path, {**data, "account_id": str(second.pk)}, format="json")
        .status_code
        == 404
    )


@override_settings(KNOWLEDGE_ENABLED=True)
def test_recovery_is_owned_current_and_does_not_leak_reference_answer(setup):
    doc, user, second, _, concept, question = setup
    bank = ActiveStudyQuestionContent.objects.create(
        sheet=concept.sheet,
        source_version=doc.version,
        difficulty="easy",
        payload={},
        plan_signature={},
        checkpoint_question_count=1,
        final_exam_question_count=1,
        created_by=user,
        updated_by=user,
    )
    canonical = f"active-study:{concept.sheet_id}:easy:bank:{bank.revision}:page:1:1"
    McqConceptLink.objects.create(
        concept=concept, canonical_key=canonical, bank_revision=bank.revision
    )
    item = ReviewItem.objects.create(
        user=user,
        canonical_key=canonical,
        first_mistake_at=timezone.now(),
        last_mistake_at=timezone.now(),
        next_review_at=timezone.now(),
    )
    path = f"/api/v1/knowledge/review-items/{item.pk}/recovery"
    response = client_for(user).get(path)
    assert response.status_code == 200, response.json()
    assert f"studyQuestion={question.pk}" in response.json()["links"][0]["start_url"]
    assert "reference_answer" not in response.content.decode()
    assert client_for(second).get(path).status_code == 404
    bank.revision += 1
    bank.save()
    assert client_for(user).get(path).json()["links"] == []

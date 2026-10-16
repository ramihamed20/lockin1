from uuid import uuid4

import pytest
from django.test import override_settings

from apps.content.tests.test_catalog_workspace import client_for
from apps.knowledge.models import Concept, ConceptSource, ExplainAttempt

from .test_api import base

pytestmark = pytest.mark.django_db


def additional(document, title):
    concept = Concept.objects.create(
        sheet=document.version.learning_object,
        title=title,
        published=True,
    )
    source = ConceptSource.objects.create(
        concept=concept,
        document=document,
        source_version=document.version,
        source_file=document.managed_file,
        page_start=1,
        page_end=1,
    )
    return concept, source


@override_settings(KNOWLEDGE_ENABLED=True)
def test_explanation_attribution_is_frozen_when_editorial_question_source_changes(setup):
    document, user, _, _, original, question = setup
    old_source_id = question.source_id
    payload = {
        "account_id": str(user.id),
        "question_id": str(question.id),
        "question_revision": 1,
        "answer": "My explanation",
        "self_rating": "needs_review",
    }
    assert (
        client_for(user)
        .put(
            f"{base(document)}/attempts/{uuid4()}",
            payload,
            format="json",
        )
        .status_code
        == 200
    )
    revised, source = additional(document, "Different concept")
    question.source = source
    question.revision = 2
    question.save()
    attempt = ExplainAttempt.objects.get()
    assert attempt.source_id == old_source_id
    projection = {
        item["id"]: item for item in client_for(user).get(base(document)).json()["concepts"]
    }
    assert projection[str(original.id)]["status"] == "needs_review"
    assert projection[str(revised.id)]["status"] == "not_practiced"


@override_settings(KNOWLEDGE_ENABLED=True)
def test_question_can_link_multiple_concepts_without_claiming_automatic_mastery(setup):
    document, user, _, _, primary, question = setup
    secondary, _ = additional(document, "Related concept")
    question.concepts.add(secondary)
    prepared = client_for(user).get(base(document)).json()["questions"][0]
    assert set(prepared["concept_ids"]) == {str(primary.id), str(secondary.id)}
    payload = {
        "account_id": str(user.id),
        "question_id": str(question.id),
        "question_revision": 1,
        "answer": "شرح",
        "self_rating": "partial",
    }
    assert (
        client_for(user)
        .put(
            f"{base(document)}/attempts/{uuid4()}",
            payload,
            format="json",
        )
        .status_code
        == 200
    )
    projection = client_for(user).get(base(document)).json()["concepts"]
    assert {item["status"] for item in projection} == {"needs_review"}
    assert all(item["self_reported"] for item in projection)
    assert all(item["verified_events"] == 0 for item in projection)

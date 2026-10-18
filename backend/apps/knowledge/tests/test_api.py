from uuid import uuid4

import pytest
from django.contrib import admin
from django.test import override_settings

from apps.accounts.tests.helpers import create_user
from apps.content.models import ActiveStudyQuestionContent, LearningObjectVersion
from apps.content.tests.test_catalog_workspace import catalog_fixture, client_for, grant_focus
from apps.focus.models import ActiveStudyAnswer, ActiveStudyAttempt, ActiveStudyRun
from apps.knowledge.models import (
    Concept,
    ConceptSource,
    ExplainAttempt,
    ExplainQuestion,
    McqConceptLink,
    StudentArtifact,
    StudyToolSettings,
)

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def private_media(tmp_path):
    with override_settings(MEDIA_ROOT=str(tmp_path)):
        yield


@pytest.fixture
def setup():
    document, own, other = catalog_fixture()
    user = create_user(email="knowledge-user@example.com", cohort=own)
    grant_focus(user)
    second = create_user(email="knowledge-other@example.com", cohort=own)
    grant_focus(second)
    outsider = create_user(email="knowledge-outside@example.com", cohort=other)
    grant_focus(outsider)
    concept = Concept.objects.create(
        sheet=document.version.learning_object,
        title="Avascular epithelium",
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
    question = ExplainQuestion.objects.create(
        source=source,
        difficulty="easy",
        prompt="Explain the sheet concept.",
        reference_answer="Prepared source answer.",
        essential_points=["First point", "Second point"],
        published=True,
    )
    document._knowledge_owner = user.id
    return document, user, second, outsider, concept, question


def base(document):
    return f"/api/v1/knowledge/documents/{document.id}"


def body(document, **patch):
    return {
        "account_id": str(document._knowledge_owner),
        "mutation_id": str(uuid4()),
        "expected_revision": 0,
        "source_version_id": str(document.version_id),
        "source_file_id": str(document.managed_file_id),
        "kind": "summary",
        "title": "My notebook",
        "page_start": 1,
        "page_end": 1,
        "content": {"text": "فكرة / concept", "paper": "ruled", "strokes": []},
        **patch,
    }


@override_settings(KNOWLEDGE_ENABLED=True)
def test_private_work_is_owner_scoped_and_replay_safe(setup):
    document, user, second, _, _, _ = setup
    identifier = uuid4()
    payload = body(document)
    path = f"{base(document)}/artifacts/{identifier}"
    first = client_for(user).put(path, payload, format="json")
    assert first.status_code == 200
    replay = client_for(user).put(path, payload, format="json")
    assert replay.json() == first.json()
    assert StudentArtifact.objects.count() == 1
    assert client_for(second).get(base(document)).json()["artifacts"] == []
    assert (
        client_for(second)
        .put(path, body(document, account_id=str(second.id)), format="json")
        .status_code
        == 404
    )
    mutated = {**payload, "title": "different"}
    assert client_for(user).put(path, mutated, format="json").status_code == 409


@override_settings(KNOWLEDGE_ENABLED=True)
def test_revision_conflict_never_overwrites_and_delete_is_a_tombstone(setup):
    document, user, *_ = setup
    path = f"{base(document)}/artifacts/{uuid4()}"
    payload = body(document)
    assert client_for(user).put(path, payload, format="json").status_code == 200
    newer = body(document, expected_revision=1, title="newer")
    assert client_for(user).put(path, newer, format="json").json()["revision"] == 2
    assert (
        client_for(user).put(path, body(document, expected_revision=1), format="json").status_code
        == 409
    )
    assert StudentArtifact.objects.get().title == "newer"
    deleted = body(document, expected_revision=2, deleted=True)
    assert client_for(user).put(path, deleted, format="json").json()["deleted"] is True
    assert StudentArtifact.objects.get().content == {}
    assert StudentArtifact.objects.get().title == ""
    assert (
        client_for(user).put(path, body(document, expected_revision=3), format="json").status_code
        == 409
    )


@override_settings(KNOWLEDGE_ENABLED=True, COHORT_CONTENT_ENFORCEMENT=True)
def test_content_access_and_tool_flags_are_server_authoritative(setup):
    document, user, _, outsider, _, _ = setup
    assert client_for(outsider).get(base(document)).status_code == 403
    assert (
        client_for(outsider)
        .put(
            f"{base(document)}/artifacts/{uuid4()}",
            body(document),
            format="json",
        )
        .status_code
        == 403
    )
    StudyToolSettings.objects.create(sheet=document.version.learning_object, summary_enabled=False)
    assert (
        client_for(user)
        .put(
            f"{base(document)}/artifacts/{uuid4()}",
            body(document),
            format="json",
        )
        .status_code
        == 403
    )
    assert client_for(user).get(base(document)).json()["tools"]["summary"] is False


@override_settings(KNOWLEDGE_ENABLED=False)
def test_disabled_domain_is_closed_and_private_models_are_not_in_admin(setup):
    document, user, *_ = setup
    assert client_for(user).get(base(document)).json() == {"enabled": False}
    assert (
        client_for(user)
        .put(
            f"{base(document)}/artifacts/{uuid4()}",
            body(document),
            format="json",
        )
        .status_code
        == 403
    )
    assert StudentArtifact not in admin.site._registry
    assert ExplainAttempt not in admin.site._registry


@override_settings(KNOWLEDGE_ENABLED=True)
@pytest.mark.parametrize(
    "content",
    [
        {"text": "hello", "raw_html": "<script/>"},
        {"nodes": [{"id": "x", "text": "x", "x": float("inf")}]},
        {"nodes": [], "edges": [{"id": "e", "from": "missing", "to": "missing"}]},
        {"text": "x" * 100001},
    ],
)
def test_invalid_and_oversized_content_is_rejected(setup, content):
    document, user, *_ = setup
    payload = body(document, content=content, kind="map" if "nodes" in content else "summary")
    # Non-numeric coordinate strings are rejected too.
    if "nodes" in content and content["nodes"]:
        content["nodes"][0]["x"] = "NaN"
    response = client_for(user).put(
        f"{base(document)}/artifacts/{uuid4()}",
        payload,
        format="json",
    )
    assert response.status_code == 400
    assert not StudentArtifact.objects.exists()


@override_settings(KNOWLEDGE_ENABLED=True)
def test_replaced_source_keeps_old_work_without_rebinding_pages(setup):
    document, user, *_ = setup
    path = f"{base(document)}/artifacts/{uuid4()}"
    payload = body(document)
    assert client_for(user).put(path, payload, format="json").status_code == 200
    old_version = document.version
    version = LearningObjectVersion.objects.create(
        learning_object=old_version.learning_object,
        version_number=2,
        academic_node=old_version.academic_node,
        content_type="pdf",
        title="Revised",
        created_by=old_version.created_by,
        page_count=1,
    )
    # Test the service's revision safety independently of reader file publication checks.
    from apps.knowledge.serializers import ArtifactWriteSerializer
    from apps.knowledge.services import artifact_payload, save_artifact

    document.version = version
    document.save(update_fields=["version"])
    item = StudentArtifact.objects.get()
    assert artifact_payload(item, document)["stale"] is True
    serializer = ArtifactWriteSerializer(
        data={**payload, "mutation_id": str(uuid4()), "expected_revision": 1}
    )
    assert serializer.is_valid()
    saved = save_artifact(user, document, item.id, serializer.validated_data)
    assert saved["source_version_id"] == str(old_version.id)
    assert saved["stale"] is True
    serializer = ArtifactWriteSerializer(data=body(document, source_version_id=str(old_version.id)))
    assert serializer.is_valid()
    from apps.knowledge.services import KnowledgeConflict

    with pytest.raises(KnowledgeConflict):
        save_artifact(user, document, uuid4(), serializer.validated_data)


@override_settings(KNOWLEDGE_ENABLED=True)
def test_explain_is_prepared_feedback_without_fake_grading(setup):
    document, user, second, _, concept, question = setup
    response = client_for(user).get(base(document)).json()
    assert "reference_answer" not in response["questions"][0]
    assert response["concepts"][0]["status"] == "not_practiced"
    identifier = uuid4()
    path = f"{base(document)}/attempts/{identifier}"
    payload = {
        "account_id": str(user.id),
        "question_id": str(question.id),
        "question_revision": 1,
        "answer": "شرح / explanation",
    }
    saved = client_for(user).put(path, payload, format="json")
    assert saved.status_code == 200
    assert saved.json()["evaluation_status"] == "self_review"
    assert "score" not in saved.json()
    assert saved.json()["feedback"]["essential_points"] == question.essential_points
    assert client_for(user).put(path, payload, format="json").json() == saved.json()
    assert ExplainAttempt.objects.count() == 1
    assert (
        client_for(second)
        .put(path, {**payload, "account_id": str(second.id)}, format="json")
        .status_code
        == 404
    )
    assert client_for(user).get(base(document)).json()["concepts"][0]["status"] == "practicing"
    question.published = False
    question.save()
    assert (
        client_for(user)
        .put(
            f"{base(document)}/attempts/{uuid4()}",
            payload,
            format="json",
        )
        .status_code
        == 404
    )


@override_settings(KNOWLEDGE_ENABLED=True)
def test_notes_never_award_mastery_and_verified_mcq_events_are_read_once(setup):
    document, user, _, _, concept, _ = setup
    payload = body(document, content={"text": "I understand", "concept_ids": [str(concept.id)]})
    assert (
        client_for(user)
        .put(
            f"{base(document)}/artifacts/{uuid4()}",
            payload,
            format="json",
        )
        .status_code
        == 200
    )
    assert client_for(user).get(base(document)).json()["concepts"][0]["status"] == "not_practiced"
    bank = ActiveStudyQuestionContent.objects.create(
        sheet=document.version.learning_object,
        difficulty="easy",
        payload={},
        plan_signature={},
        checkpoint_question_count=1,
        final_exam_question_count=1,
        created_by=user,
        updated_by=user,
        source_version=document.version,
    )
    McqConceptLink.objects.create(
        concept=concept,
        canonical_key=f"active-study:{concept.sheet_id}:easy:checkpoint:1:1",
        bank_revision=bank.revision,
    )
    run = ActiveStudyRun.objects.create(
        user=user,
        sheet=document.version.learning_object,
        material_slug="anatomy",
        sheet_slug="cranial-nerves",
        difficulty="easy",
        page_count=1,
        unlocked_pages=1,
    )
    from django.utils import timezone

    attempt = ActiveStudyAttempt.objects.create(
        run=run,
        kind="checkpoint",
        part_number=1,
        number=1,
        total=1,
        submitted_at=timezone.now(),
    )
    ActiveStudyAnswer.objects.create(
        attempt=attempt,
        question_position=1,
        selected_answer="A",
        was_correct=False,
    )
    projection = client_for(user).get(base(document)).json()["concepts"][0]
    assert projection["status"] == "needs_review"
    assert projection["verified_events"] == 1
    assert client_for(user).get(base(document)).json()["concepts"][0]["verified_events"] == 1
    bank.revision += 1
    bank.save()
    assert client_for(user).get(base(document)).json()["concepts"][0]["status"] == "not_practiced"

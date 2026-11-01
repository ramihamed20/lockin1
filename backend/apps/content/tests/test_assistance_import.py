import copy
from uuid import uuid4

import pytest

from apps.audit.models import AuditRecord
from apps.content.assistance_import import subject_for
from apps.content.models import SavedStudyAssistanceIdea, StudyAssistanceIdea

from .helpers import published_pdf
from .test_catalog_workspace import client_for
from .test_study_assistance import context as context  # noqa: F401

pytestmark = pytest.mark.django_db


def endpoint(document):
    sheet_id = document.version.learning_object_id
    return f"/api/v1/operations/admin/content/sheets/{sheet_id}/assistance/import"


def payload(document):
    return {
        "schema_version": 1,
        "subject_id": str(subject_for(document.version.learning_object).id),
        "edition": "university",
        "view": "study",
        "sheets": [
            {
                "sheet_id": str(document.version.learning_object_id),
                "source_version_id": str(document.version_id),
                "cards": [
                    {
                        "key": "idea-01",
                        "page": 1,
                        "kind": "simplify",
                        "teaser": "A small idea",
                        "question": "Short title",
                        "explanation": "One concise explanation.",
                    }
                ],
            }
        ],
    }


def admin(document):
    return client_for(document.version.learning_object.owner)


def test_preview_drafts_retry_and_update_preserve_saved_cards(context):
    document, student, *_ = context
    client = admin(document)
    body = {"payload": payload(document)}
    preview = client.post(endpoint(document), body, format="json")
    assert preview.status_code == 200, preview.content
    assert preview.json()["count"] == 1
    assert StudyAssistanceIdea.objects.count() == 0
    body["preview_token"] = preview.json()["preview_token"]
    saved = client.post(endpoint(document), body, format="json")
    assert saved.status_code == 200, saved.content
    row = StudyAssistanceIdea.objects.get()
    assert row.is_published is False
    SavedStudyAssistanceIdea.objects.create(user=student, idea=row)
    assert client.post(endpoint(document), body, format="json").json()["changed_count"] == 0
    assert StudyAssistanceIdea.objects.count() == 1
    assert AuditRecord.objects.filter(action="content.study_assistance_imported").count() == 1
    body.pop("preview_token")
    body["publish"] = True
    body["payload"]["sheets"][0]["cards"][0]["explanation"] = "Corrected short explanation."
    preview = client.post(endpoint(document), body, format="json")
    body["preview_token"] = preview.json()["preview_token"]
    assert client.post(endpoint(document), body, format="json").status_code == 200
    row.refresh_from_db()
    assert row.is_published and row.revision == 2
    assert SavedStudyAssistanceIdea.objects.get().idea_id == row.id


def test_manifest_and_multiple_sheets_are_scoped_to_one_subject(context):
    document, *_ = context
    other = published_pdf(
        actor=document.version.learning_object.owner,
        node=document.version.academic_node,
        title="Second sheet",
    )
    client = admin(document)
    manifest = client.get(endpoint(document)).json()
    assert {s["sheet_id"] for s in manifest["sheets"]} == {
        str(other.id),
        str(document.version.learning_object_id),
    }
    data = payload(document)
    second = copy.deepcopy(data["sheets"][0])
    second.update(sheet_id=str(other.id), source_version_id=str(other.current_version_id))
    second["cards"][0]["page"] = None
    data["sheets"].append(second)
    preview = client.post(endpoint(document), {"payload": data}, format="json")
    assert preview.status_code == 200, preview.content
    assert (
        client.post(
            endpoint(document),
            {"payload": data, "preview_token": preview.json()["preview_token"]},
            format="json",
        ).status_code
        == 200
    )
    assert StudyAssistanceIdea.objects.count() == 2


def test_wrong_subject_version_and_invalid_cards_do_not_write(context):
    document, *_ = context
    client = admin(document)
    for mutate in [
        lambda p: p.update(subject_id=str(uuid4())),
        lambda p: p["sheets"][0].update(source_version_id=str(uuid4())),
        lambda p: p["sheets"][0]["cards"][0].update(page=999),
        lambda p: p["sheets"][0]["cards"][0].update(explanation="x" * 601),
        lambda p: p["sheets"][0]["cards"][0].update(followup_question="Missing answer"),
        lambda p: p["sheets"][0]["cards"].append(p["sheets"][0]["cards"][0].copy()),
    ]:
        data = payload(document)
        mutate(data)
        result = client.post(endpoint(document), {"payload": data}, format="json")
        assert result.status_code in (400, 409), result.content
    assert StudyAssistanceIdea.objects.count() == 0


def test_actor_publish_and_stale_preview_guards(context):
    document, student, *_ = context
    client = admin(document)
    body = {"payload": payload(document)}
    assert client_for(student).post(endpoint(document), body, format="json").status_code == 403
    result = client.post(endpoint(document), body, format="json")
    body["preview_token"] = result.json()["preview_token"]
    assert (
        client.post(endpoint(document), {**body, "publish": True}, format="json").status_code == 409
    )
    assert (
        client.post(
            endpoint(document), {**body, "preview_token": "tampered"}, format="json"
        ).status_code
        == 409
    )
    # Any manual edit made after preview must be reviewed again.
    StudyAssistanceIdea.objects.create(
        source_version=document.version, teaser="New", question="New", explanation="New"
    )
    assert client.post(endpoint(document), body, format="json").status_code == 409
    assert StudyAssistanceIdea.objects.count() == 1


def test_late_failure_rolls_back_every_card(context, monkeypatch):
    from apps.content import assistance_import

    document, *_ = context
    actor = document.version.learning_object.owner
    data = payload(document)
    data["sheets"][0]["cards"].append({**data["sheets"][0]["cards"][0], "key": "idea-02"})
    kwargs = {"actor": actor, "anchor_id": document.version.learning_object_id, "raw": data}
    preview = assistance_import.import_cards(**kwargs)

    def audit_failure(**kwargs):
        raise RuntimeError("audit write failed")

    monkeypatch.setattr(assistance_import, "record_audit", audit_failure)
    with pytest.raises(RuntimeError, match="audit write failed"):
        assistance_import.import_cards(**kwargs, token=preview["preview_token"])
    assert StudyAssistanceIdea.objects.count() == 0


def test_mixed_subject_file_is_rejected_as_a_whole(context):
    from apps.education.models import EducationNode
    from apps.education.services import create_node, set_node_status

    document, *_ = context
    actor = document.version.learning_object.owner
    subject = subject_for(document.version.learning_object)
    other_subject = create_node(
        actor=actor, parent=subject.parent, kind=EducationNode.Kind.SUBJECT, title="Other subject"
    )
    other_subject = set_node_status(
        actor=actor,
        node_id=other_subject.id,
        expected_revision=other_subject.revision,
        status=EducationNode.Status.PUBLISHED,
    )
    other = published_pdf(actor=actor, node=other_subject)
    data = payload(document)
    second = copy.deepcopy(data["sheets"][0])
    second.update(sheet_id=str(other.id), source_version_id=str(other.current_version_id))
    second["cards"][0]["page"] = None
    data["sheets"].append(second)
    response = admin(document).post(endpoint(document), {"payload": data}, format="json")
    assert response.status_code == 400, response.content
    assert StudyAssistanceIdea.objects.count() == 0

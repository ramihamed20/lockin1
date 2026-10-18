from uuid import uuid4

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.content.tests.test_catalog_workspace import client_for
from apps.knowledge.models import StudentArtifact

from .test_api import base, body

pytestmark = pytest.mark.django_db


@override_settings(KNOWLEDGE_ENABLED=True)
def test_account_switch_cannot_replay_old_account_content_as_new_owner(setup):
    document, _, second, *_ = setup
    response = client_for(second).put(
        f"{base(document)}/artifacts/{uuid4()}",
        body(document),
        format="json",
    )
    assert response.status_code == 403
    assert not StudentArtifact.objects.exists()


@override_settings(KNOWLEDGE_ENABLED=True)
def test_index_is_lightweight_and_details_and_library_remain_private(setup):
    document, user, second, *_ = setup
    identifier = uuid4()
    path = f"{base(document)}/artifacts/{identifier}"
    payload = body(document, content={"text": "private text"})
    assert client_for(user).put(path, payload, format="json").status_code == 200
    index = client_for(user).get(base(document)).json()["artifacts"][0]
    assert index["content"] is None
    assert client_for(user).get(path).json()["content"]["text"] == "private text"
    assert client_for(second).get(path).status_code == 404
    assert client_for(second).get("/api/v1/knowledge/library").json()["documents"] == []
    library = client_for(user).get("/api/v1/knowledge/library").json()["documents"]
    assert library[0]["id"] == str(document.id)
    assert "private text" not in str(library)


@override_settings(KNOWLEDGE_ENABLED=True)
def test_page_limits_use_the_edition_file_not_the_shared_version_count(setup):
    document, user, *_ = setup
    document.version.page_count = 1
    document.version.save(update_fields=["page_count"])
    document.managed_file.pdf_page_count = 7
    document.managed_file.save(update_fields=["pdf_page_count"])
    assert (
        client_for(user)
        .put(
            f"{base(document)}/artifacts/{uuid4()}",
            body(document, page_end=7),
            format="json",
        )
        .status_code
        == 200
    )
    assert (
        client_for(user)
        .put(
            f"{base(document)}/artifacts/{uuid4()}",
            body(document, page_end=8),
            format="json",
        )
        .status_code
        == 400
    )


@override_settings(KNOWLEDGE_ENABLED=True)
def test_cookie_authenticated_writes_still_require_csrf(setup):
    document, user, *_ = setup
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)
    assert (
        client.put(
            f"{base(document)}/artifacts/{uuid4()}",
            body(document),
            format="json",
        ).status_code
        == 403
    )
    assert not StudentArtifact.objects.exists()


@override_settings(KNOWLEDGE_ENABLED=True)
def test_question_revision_change_does_not_regrade_or_overwrite_old_feedback(setup):
    document, user, _, _, _, question = setup
    identifier = uuid4()
    path = f"{base(document)}/attempts/{identifier}"
    payload = {
        "account_id": str(user.id),
        "question_id": str(question.id),
        "question_revision": 1,
        "answer": "My explanation",
    }
    original = client_for(user).put(path, payload, format="json").json()
    question.revision = 2
    question.reference_answer = "Revised rubric"
    question.save()
    assert client_for(user).put(path, payload, format="json").json() == original
    assert (
        client_for(user)
        .put(
            f"{base(document)}/attempts/{uuid4()}",
            payload,
            format="json",
        )
        .status_code
        == 409
    )

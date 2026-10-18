import json
from uuid import uuid4

import pytest
from django.test import override_settings

from apps.content.tests.test_catalog_workspace import client_for
from apps.knowledge.models import ExplainAttempt, StudentArtifact

from .test_api import base, body

pytestmark = pytest.mark.django_db


@override_settings(KNOWLEDGE_ENABLED=True)
@pytest.mark.parametrize("field", ["content", "title", "answer"])
@pytest.mark.parametrize("invalid", ["\ud800", "bad\x00value"])
def test_invalid_unicode_is_rejected_without_a_server_error_or_saved_row(setup, field, invalid):
    document, user, _, _, _, question = setup
    if field == "answer":
        path = f"{base(document)}/attempts/{uuid4()}"
        payload = {
            "account_id": str(user.id),
            "question_id": str(question.id),
            "question_revision": question.revision,
            "answer": invalid,
        }
    else:
        path = f"{base(document)}/artifacts/{uuid4()}"
        payload = body(document)
        if field == "content":
            payload["content"] = {"text": invalid}
        else:
            payload["title"] = invalid
    response = client_for(user).put(path, json.dumps(payload), content_type="application/json")
    assert response.status_code == 400
    assert not StudentArtifact.objects.exists()
    assert not ExplainAttempt.objects.exists()

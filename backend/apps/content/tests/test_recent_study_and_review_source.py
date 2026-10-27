from datetime import timedelta
from unittest.mock import patch

import pytest
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.accounts.tests.helpers import create_user
from apps.content.models import CatalogWorkspaceSnapshot, LearningObjectVersion
from apps.questions.models import Question, QuestionVersion
from apps.review.models import ReviewItem

from .test_catalog_workspace import catalog_fixture, client_for, grant_focus

pytestmark = pytest.mark.django_db


def review_item(user, document):
    owner = document.version.learning_object.owner
    question = Question.objects.create(owner=owner)
    version = QuestionVersion.objects.create(
        question=question,
        version_number=1,
        academic_node=document.version.academic_node,
        source_learning_object=document.version.learning_object,
        source_page=1,
        question_type="single_choice",
        prompt="Source question",
        created_by=owner,
    )
    now = timezone.now()
    return ReviewItem.objects.create(
        user=user,
        canonical_key="source-question",
        last_question_version=version,
        subject_key="anatomy",
        subject_label_snapshot="Anatomy",
        source_type="sheet",
        prompt_snapshot="Source question",
        first_mistake_at=now,
        last_mistake_at=now,
        next_review_at=now,
    )


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_recent_study_is_owned_reauthorized_and_returns_no_workspace_content():
    document, own, other = catalog_fixture()
    user = create_user(email="recent-owner@example.com", cohort=own)
    stranger = create_user(email="recent-stranger@example.com", cohort=own)
    grant_focus(user)
    grant_focus(stranger)
    CatalogWorkspaceSnapshot.objects.create(
        user=user,
        document=document,
        revision=1,
        state={"private_notes": "private writing"},
    )
    url = "/api/v1/catalog/workspaces/recent"
    response = client_for(user).get(url)
    assert response.status_code == 200
    assert response.json()["results"][0]["sheet_slug"] == document.sheet_slug
    assert "private writing" not in response.content.decode()
    assert client_for(stranger).get(url).json()["results"] == []
    user.cohort = other
    user.save(update_fields=("cohort",))
    assert client_for(user).get(url).json()["results"] == []


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_review_source_checks_owner_entitlement_publication_and_current_page():
    document, own, _ = catalog_fixture()
    user = create_user(email="source-owner@example.com", cohort=own)
    stranger = create_user(email="source-stranger@example.com", cohort=own)
    LearningObjectVersion.objects.filter(pk=document.version_id).update(page_count=1)
    item = review_item(user, document)
    url = f"/api/v1/review-bank/items/{item.id}/source"
    with patch(
        "apps.content.views.require_entitlement", side_effect=PermissionDenied("Expired access")
    ):
        denied = client_for(user).get(url)
        assert denied.status_code == 403, denied.content
    grant_focus(user)
    result = client_for(user).get(url)
    assert result.status_code == 200, result.content
    assert result.json()["page"] == 1
    assert result.json()["document_version_id"] == str(document.version_id)
    assert "correct_option_ids" not in result.json()
    assert client_for(stranger).get(url).status_code == 404
    LearningObjectVersion.objects.filter(pk=document.version_id).update(
        created_at=item.last_question_version.created_at + timedelta(seconds=1)
    )
    assert client_for(user).get(url).status_code == 404

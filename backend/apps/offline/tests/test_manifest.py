from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.models import CatalogSubject
from apps.content.tests.test_catalog_workspace import catalog_fixture
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant

pytestmark = pytest.mark.django_db


def _client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def _grant(user):
    EntitlementGrant.objects.create(
        user=user,
        entitlement=EntitlementDefinition.objects.get(code="content.premium"),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
        ends_at=timezone.now() + timedelta(hours=2),
    )


def test_manifest_exposes_only_owned_published_documents() -> None:
    document, own, other = catalog_fixture()
    CatalogSubject.objects.update_or_create(
        source_node=document.version.academic_node.parent,
        defaults={"cohort": own, "slug": "anatomy", "title": "Anatomy", "material_slug": "anatomy"},
    )
    allowed = create_user(email="offline-own@example.com", cohort=own)
    denied = create_user(email="offline-other@example.com", cohort=other)
    _grant(allowed)
    _grant(denied)
    response = _client(allowed).get("/api/v1/offline/manifest/")
    other_response = _client(denied).get("/api/v1/offline/manifest/")
    assert response.status_code == other_response.status_code == 200
    assert any(item["download_url"].endswith("/view") for item in response.json()["items"])
    assert other_response.json()["items"] == []
    document.is_active = False
    document.save(update_fields=["is_active"])
    assert _client(allowed).get("/api/v1/offline/manifest/").json()["items"] == []

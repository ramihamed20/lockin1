import uuid

import pytest
from django.db import connection
from django.test import Client
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.discovery.models import SearchEntry, SearchTerm


@pytest.mark.django_db
def test_health_endpoints_have_bounded_query_cost() -> None:
    client = Client()

    with CaptureQueriesContext(connection) as live_queries:
        live_response = client.get("/api/v1/health/live")
    with CaptureQueriesContext(connection) as ready_queries:
        ready_response = client.get("/api/v1/health/ready")

    assert live_response.status_code == 200
    assert ready_response.status_code == 200
    assert len(live_queries) == 0
    assert len(ready_queries) == 1


@pytest.mark.django_db
def test_search_query_cost_does_not_grow_with_result_count() -> None:
    now = timezone.now()
    entries = SearchEntry.objects.bulk_create(
        [
            SearchEntry(
                resource_kind="lesson",
                resource_id=uuid.uuid4(),
                content_type="pdf",
                title=f"Anatomy lesson {index:03d}",
                normalized_title=f"anatomy lesson {index:03d}",
                summary="Bounded-query production-readiness fixture.",
                language="en",
                academic_path="university/college/department/year/semester/subject",
                published_at=now,
            )
            for index in range(100)
        ]
    )
    SearchTerm.objects.bulk_create([SearchTerm(entry=entry, term="anatomy") for entry in entries])
    client = APIClient()
    client.force_authenticate(create_user())

    with CaptureQueriesContext(connection) as queries:
        response = client.get("/api/v1/search?q=anatomy")

    assert response.status_code == 200
    assert response.json()["count"] == 100
    assert len(response.json()["results"]) == 25
    assert len(queries) <= 3

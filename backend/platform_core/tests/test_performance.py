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
    client = APIClient()
    client.force_authenticate(create_user(with_trial=True))

    def create_entries(start: int, stop: int) -> None:
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
                for index in range(start, stop)
            ]
        )
        SearchTerm.objects.bulk_create(
            [SearchTerm(entry=entry, term="anatomy") for entry in entries]
        )

    create_entries(0, 12)
    with CaptureQueriesContext(connection) as baseline_queries:
        baseline_response = client.get("/api/v1/search?q=anatomy")

    create_entries(12, 100)
    with CaptureQueriesContext(connection) as expanded_queries:
        expanded_response = client.get("/api/v1/search?q=anatomy")

    assert baseline_response.status_code == 200
    assert expanded_response.status_code == 200
    # Global search is deliberately a bounded type-ahead API. Its count is
    # the number of returned cards, not the total number of matching index rows.
    assert baseline_response.json()["count"] == 12
    assert expanded_response.json()["count"] == 12
    assert len(expanded_response.json()["results"]) == 12
    # The number of SQL round trips must stay constant as the matching index
    # grows. Keep a small ceiling as a regression guard for accidental N+1s.
    assert len(expanded_queries) <= len(baseline_queries)
    assert len(expanded_queries) <= 8

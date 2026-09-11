"""The Lock In screen must not get slower as the product gets bigger.

Two payloads on this screen used to issue queries per row: the weekly team
rankings walked every team with an aggregate and a count each, and the material
list resolved every candidate document individually. Both grew without bound
while the response they produce is a fixed size.

These tests assert the shape rather than a magic number: the query count must
not change when the data does.
"""

from __future__ import annotations

from typing import Any

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.tests.helpers import published_pdf
from apps.education.tests.helpers import create_admin, published_path

from ..models import FocusTeam, FocusTeamMembership
from ..views import _lock_in_materials, _team_rankings_payload

pytestmark = pytest.mark.django_db


def _teams(count: int) -> None:
    """Add ``count`` more teams, continuing from whatever already exists."""

    start = FocusTeam.objects.count()
    for offset in range(count):
        index = start + offset
        team = FocusTeam.objects.create(
            name=f"Team {index:02d}",
            owner=create_user(email=f"owner{index}@example.com"),
            invite_code=f"invite{index:04d}",
        )
        FocusTeamMembership.objects.create(team=team, user=team.owner, role="owner")


def _count(callable_under_test: Any) -> int:
    with CaptureQueriesContext(connection) as queries:
        callable_under_test()
    return len(queries.captured_queries)


def test_team_rankings_cost_the_same_for_two_teams_as_for_twenty() -> None:
    _teams(2)
    small = _count(_team_rankings_payload)

    _teams(18)
    large = _count(_team_rankings_payload)

    assert small == large, "team rankings must not issue queries per team"
    # One query for the annotated, ordered, limited set.
    assert large == 1


def test_team_rankings_still_report_the_right_members_and_order() -> None:
    """The join that aggregates sessions must not multiply the member count."""

    _teams(3)
    extra = FocusTeam.objects.get(name="Team 00")
    FocusTeamMembership.objects.create(
        team=extra, user=create_user(email="second-member@example.com"), role="member"
    )

    rows = _team_rankings_payload()

    assert [row["name"] for row in rows] == ["Team 00", "Team 01", "Team 02"]
    by_name = {row["name"]: row for row in rows}
    assert by_name["Team 00"]["member_count"] == 2
    assert by_name["Team 01"]["member_count"] == 1
    assert all(row["weekly_active_seconds"] == 0 for row in rows)


def test_material_resolution_costs_the_same_for_one_document_as_for_six() -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    student = create_user(email="materials-budget@example.com", with_trial=True)

    published_pdf(actor=admin, node=lesson, title="Sheet 1")
    small = _count(lambda: _lock_in_materials(user=student))

    for index in range(2, 7):
        published_pdf(actor=admin, node=lesson, title=f"Sheet {index}")
    large = _count(lambda: _lock_in_materials(user=student))

    assert small == large, "material resolution must not issue queries per document"
    assert len(_lock_in_materials(user=student)) == 6


def test_material_payload_keeps_its_exact_shape() -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    student = create_user(email="materials-shape@example.com", with_trial=True)
    published_pdf(actor=admin, node=lesson, title="Cranial nerves guide")

    materials = _lock_in_materials(user=student)

    assert len(materials) == 1
    assert set(materials[0]) == {
        "document_id",
        "document_version_id",
        "file_id",
        "title",
        "language",
        "view_url",
        "size_bytes",
        "checksum_sha256",
        "page_count",
    }
    assert materials[0]["title"] == "Cranial nerves guide"
    assert materials[0]["view_url"] == f"/api/v1/files/{materials[0]['file_id']}/view"


def test_an_undiscoverable_material_is_still_excluded() -> None:
    """The bulk path must apply the same access rule the per-row path did."""

    from apps.education.models import EducationNode

    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    student = create_user(email="materials-hidden@example.com", with_trial=True)
    published_pdf(actor=admin, node=lesson, title="Hidden sheet")

    assert len(_lock_in_materials(user=student)) == 1
    EducationNode.objects.filter(id=lesson.id).update(is_discoverable=False)
    assert _lock_in_materials(user=student) == []


def test_the_lock_in_screen_is_flat_in_queries(django_assert_max_num_queries: Any) -> None:
    """End to end, through the endpoint the reader actually calls."""

    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    student = create_user(email="lock-in-budget@example.com", with_trial=True)
    for index in range(6):
        published_pdf(actor=admin, node=lesson, title=f"Bulk sheet {index}")
    _teams(10)
    client = APIClient()
    client.force_authenticate(student)

    # Warm the request so per-process caches are not counted as growth.
    assert client.get("/api/v1/focus/lock-in").status_code == 200

    with CaptureQueriesContext(connection) as first:
        assert client.get("/api/v1/focus/lock-in").status_code == 200

    for index in range(6, 18):
        published_pdf(actor=admin, node=lesson, title=f"Bulk sheet {index}")
    _teams(10)

    with CaptureQueriesContext(connection) as second:
        assert client.get("/api/v1/focus/lock-in").status_code == 200

    assert len(second.captured_queries) == len(first.captured_queries), (
        "the Lock In payload must not issue queries per material or per team"
    )

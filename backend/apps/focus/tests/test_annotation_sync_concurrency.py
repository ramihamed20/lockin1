from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from django.db import close_old_connections

from .test_workspace import _client, _stroke, _workspace_fixture


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_two_devices_conflict_then_replay_without_losing_either_addition() -> None:
    _, student, _, version_id = _workspace_fixture()
    barrier = Barrier(2)

    def push(annotation_id: str) -> tuple[str, int]:
        close_old_connections()
        try:
            client = _client(student)
            barrier.wait(timeout=10)
            response = client.post(
                f"/api/v1/focus/documents/{version_id}/annotations",
                {
                    "expected_collection_revision": 0,
                    "idempotency_key": str(uuid4()),
                    "annotations": [_stroke(annotation_id)],
                    "deleted_ids": [],
                },
                format="json",
            )
            return annotation_id, response.status_code
        finally:
            close_old_connections()

    ids = [str(uuid4()), str(uuid4())]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(push, ids))

    assert sorted(status for _, status in results) == [200, 409]
    losing_id = next(annotation_id for annotation_id, status in results if status == 409)
    client = _client(student)
    current = client.get(f"/api/v1/focus/documents/{version_id}/annotations?pages=1")
    replayed = client.post(
        f"/api/v1/focus/documents/{version_id}/annotations",
        {
            "expected_collection_revision": current.json()["collection_revision"],
            "idempotency_key": str(uuid4()),
            "annotations": [_stroke(losing_id)],
            "deleted_ids": [],
        },
        format="json",
    )
    converged = client.get(f"/api/v1/focus/documents/{version_id}/annotations?pages=1")

    assert replayed.status_code == 200
    assert {item["id"] for item in converged.json()["results"]} == set(ids)
